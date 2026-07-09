from fastapi import APIRouter, Query, Depends, HTTPException
from typing import List, Optional
from datetime import datetime
from app.db import get_database, db_instance
from app.models import MachineRecordResponse
from app import config

router = APIRouter(prefix="/api/v1/machines", tags=["Machines"])

def map_mongo_to_response(doc: dict) -> dict:
    if not doc:
        return doc
    
    # Convert ObjectId to string
    doc["_id"] = str(doc["_id"])
    
    # Map 'value' field to 'driverTCKN' if it looks like a TCKN (11-digit numeric value)
    val = doc.get("value")
    if val is not None:
        try:
            int_val = int(val)
            if int_val >= 10000000000:  # 11 digits minimum
                doc["driverTCKN"] = int_val
            else:
                doc["driverTCKN"] = None
        except (ValueError, TypeError):
            doc["driverTCKN"] = None
    else:
        doc["driverTCKN"] = None
        
    # Standardize speed and calculate isSpeeding
    speed = doc.get("speed")
    if speed is None:
        speed = 0.0
    doc["speed"] = float(speed)
    doc["isSpeeding"] = speed > config.SPEED_LIMIT
    
    # Ensure coordinates are float list
    location = doc.get("location", {})
    if isinstance(location, dict):
        coords = location.get("coordinates")
        if isinstance(coords, list):
            location["coordinates"] = [float(x) for x in coords]
            
    # Map optional seedType field
    doc["seedType"] = doc.get("seedType", None)
    return doc

@router.get("/live", response_model=List[MachineRecordResponse])
async def get_live_machines(
    plate: Optional[str] = Query(None, description="Biçerdöver plakası"),
    driverTCKN: Optional[int] = Query(None, description="Sürücü TCKN (veritabanında 'value' alanında sorgulanır)"),
    areaCode: Optional[int] = Query(None, description="Bölge kodu (örn: Tekirdağ için 59, Aydın için 9)")
):
    """
    Biçerdöverlerin en güncel konum ve çalışma verilerini döndürür.
    Varsayılan olarak her plakanın en son kaydını gruplayarak getirir.
    """
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Veritabanı bağlantısı kurulamadı.")
        
    col = db["records"]
    
    # Match stage
    match_stage = {
        "isDeleted": {"$ne": True},
        "measurementDate": {"$gte": config.START_DATE},
        "location.coordinates": {"$exists": True, "$ne": None},
        "$expr": {
            "$and": [
                {"$gt": [{"$size": "$location.coordinates"}, 1]},
                {"$ne": [{"$arrayElemAt": ["$location.coordinates", 0]}, 0.0]},
                {"$ne": [{"$arrayElemAt": ["$location.coordinates", 1]}, 0.0]}
            ]
        }
    }
    # Enforce allowed plates whitelist if defined_devices table is not empty
    if db_instance.allowed_plates:
        if plate:
            if plate not in db_instance.allowed_plates:
                match_stage["plate"] = "__NOT_ALLOWED__"
            else:
                match_stage["plate"] = plate
        else:
            match_stage["plate"] = {"$in": list(db_instance.allowed_plates)}
    else:
        if plate:
            match_stage["plate"] = plate
    if driverTCKN:
        # Match value field against the numeric driverTCKN
        # PyMongo/MongoDB can match float 22622184760.0 to integer 22622184760
        match_stage["value"] = driverTCKN
    if areaCode:
        match_stage["areaCode"] = areaCode
        
    pipeline = []
    pipeline.append({"$match": match_stage})
    
    # Sort by measurementDate descending so that $first picks the latest record
    pipeline.append({"$sort": {"measurementDate": -1}})
    
    # Group by plate to get the latest record per harvester and calculate stats
    pipeline.append({
        "$group": {
            "_id": "$plate",
            "doc": {"$first": "$$ROOT"},
            "avgSpeed": {"$avg": "$speed"},
            "avgHumidity": {"$avg": "$humidity"},
            "speedingCount": {
                "$sum": {
                    "$cond": [{"$gt": ["$speed", config.SPEED_LIMIT]}, 1, 0]
                }
            }
        }
    })
    
    # Project to make the merged document the root
    pipeline.append({
        "$replaceRoot": {
            "newRoot": {
                "$mergeObjects": [
                    "$doc",
                    {
                        "avgSpeed": "$avgSpeed",
                        "avgHumidity": "$avgHumidity",
                        "speedingCount": "$speedingCount"
                    }
                ]
            }
        }
    })
    
    try:
        cursor = col.aggregate(pipeline)
        raw_results = await cursor.to_list(length=None)
        
        # Map and validate
        results = [map_mongo_to_response(doc) for doc in raw_results]
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sorgu hatası: {str(e)}")

@router.get("/history", response_model=List[MachineRecordResponse])
async def get_machine_history(
    startDate: Optional[datetime] = Query(None, description="Başlangıç tarihi (ISO format)"),
    endDate: Optional[datetime] = Query(None, description="Bitiş tarihi (ISO format)"),
    plate: Optional[str] = Query(None, description="Biçerdöver plakası"),
    driverTCKN: Optional[int] = Query(None, description="Sürücü TCKN"),
    areaCode: Optional[int] = Query(None, description="Bölge kodu")
):
    """
    Biçerdöverlerin belirtilen kriterlere göre geçmiş konum ve çalışma verilerini kronolojik sırayla döndürür.
    """
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Veritabanı bağlantısı kurulamadı.")
        
    col = db["records"]
    
    # Build query
    query = {
        "isDeleted": {"$ne": True},
        "location.coordinates": {"$exists": True, "$ne": None},
        "$expr": {
            "$and": [
                {"$gt": [{"$size": "$location.coordinates"}, 1]},
                {"$ne": [{"$arrayElemAt": ["$location.coordinates", 0]}, 0.0]},
                {"$ne": [{"$arrayElemAt": ["$location.coordinates", 1]}, 0.0]}
            ]
        }
    }
    # Enforce allowed plates whitelist if defined_devices table is not empty
    if db_instance.allowed_plates:
        if plate:
            if plate not in db_instance.allowed_plates:
                query["plate"] = "__NOT_ALLOWED__"
            else:
                query["plate"] = plate
        else:
            query["plate"] = {"$in": list(db_instance.allowed_plates)}
    else:
        if plate:
            query["plate"] = plate
    if driverTCKN:
        query["value"] = driverTCKN
    if areaCode:
        query["areaCode"] = areaCode
        
    # Date range filters (making timezone naive to match DB naive datetimes)
    date_filter = {}
    
    # Enforce minimum start date from config
    min_start = config.START_DATE
    if startDate:
        naive_start = startDate.replace(tzinfo=None) if startDate.tzinfo else startDate
        date_filter["$gte"] = max(naive_start, min_start)
    else:
        date_filter["$gte"] = min_start
        
    if endDate:
        naive_end = endDate.replace(tzinfo=None) if endDate.tzinfo else endDate
        date_filter["$lte"] = naive_end
        
    query["measurementDate"] = date_filter
        
    try:
        # Query and sort chronologically (ascending)
        cursor = col.find(query).sort("measurementDate", 1)
        raw_results = await cursor.to_list(length=1000)  # Cap at 1000 records for performance
        
        results = [map_mongo_to_response(doc) for doc in raw_results]
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sorgu hatası: {str(e)}")

@router.post("/debug-receive", tags=["Debug"])
async def debug_receive_telemetry(payload: dict):
    """
    Test ve doğrulama amaçlı, yönlendirilen biçerdöver telemetri paketlerini
    terminale yazdırıp başarılı döner.
    """
    print(f"\n[DEBUG RECEIVE] Yeni Biçerdöver Verisi Alındı:")
    print(f"  Plaka: {payload.get('plate')}")
    print(f"  Hız: {payload.get('speed')} km/s (Speeding: {payload.get('isSpeeding')})")
    print(f"  Sürücü TCKN: {payload.get('driverTCKN')}")
    print(f"  Bölge: {payload.get('areaName')} ({payload.get('areaCode')})")
    print(f"  Tohum Türü: {payload.get('seedType')}")
    print(f"  Konum (Lat/Lng): {payload.get('location', {}).get('coordinates')}")
    return {"status": "received", "plate": payload.get("plate")}

