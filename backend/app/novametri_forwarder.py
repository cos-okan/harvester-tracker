import asyncio
import httpx
from datetime import datetime, timezone
from bson import ObjectId
from app.db import get_database
from app import config

async def get_next_message_no(db, plate: str, cache: dict) -> int:
    """
    Get the next messageNo for a vehicle, using local cache first to avoid race conditions.
    """
    if plate in cache:
        cache[plate] += 1
        return cache[plate]
    
    # Query database for the latest messageNo of this vehicle
    latest_msg = await db["novametri_messages"].find_one(
        {"cihazId": plate},
        sort=[("messageNo", -1)]
    )
    
    if latest_msg and "messageNo" in latest_msg:
        next_no = latest_msg["messageNo"] + 1
    else:
        next_no = 1
        
    cache[plate] = next_no
    return next_no

async def novametri_worker_loop():
    # Wait a few seconds for initialization to settle
    await asyncio.sleep(5.0)
    
    print("Novametri Forwarder: Background service starting.")
    
    # HTTP Client with timeout
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                db = get_database()
                if db is None:
                    print("Novametri Forwarder: Database not ready. Retrying in 10s.")
                    await asyncio.sleep(10.0)
                    continue
                
                # Verify that Novametri integration settings are configured
                if not config.NOVAMETRI_URL or not config.NOVAMETRI_API_KEY:
                    print("Novametri Forwarder: URL or API key not configured. Sleeping.")
                    await asyncio.sleep(config.NOVAMETRI_INTERVAL)
                    continue
                
                # Fetch all records with valid coordinates that are not yet successfully sent to Novametri
                # Filter criteria:
                # - isDeleted not True
                # - measurementDate >= config.START_DATE
                # - location.coordinates exists, is a list of size >= 2, and is not [0.0, 0.0]
                # - Either no sent record in novametri_messages OR isSentToNovametri is False
                pipeline = [
                    {
                        "$match": {
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
                    },
                    {
                        "$lookup": {
                            "from": "novametri_messages",
                            "localField": "_id",
                            "foreignField": "_id",
                            "as": "sent_status"
                        }
                    },
                    {
                        "$match": {
                            "$or": [
                                {"sent_status": {"$size": 0}},
                                {"sent_status.isSentToNovametri": False}
                            ]
                        }
                    },
                    {
                        "$sort": {"measurementDate": 1}  # Chronological order
                    }
                ]
                
                records_col = db["records"]
                cursor = records_col.aggregate(pipeline)
                unsent_records = await cursor.to_list(length=100) # Process batch of 100
                
                if unsent_records:
                    print(f"Novametri Forwarder: Found {len(unsent_records)} record(s) to process.")
                    
                    # Local cache to track messageNo increments during this batch
                    message_no_cache = {}
                    
                    for doc in unsent_records:
                        doc_id = doc["_id"]
                        plate = doc.get("plate")
                        measurement_date = doc.get("measurementDate")
                        
                        if not plate or not measurement_date:
                            # Skip records without plate or measurementDate
                            continue
                        
                        # Get sequential messageNo
                        message_no = await get_next_message_no(db, plate, message_no_cache)
                        
                        # Map fields to Novametri schema
                        sent_at_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        
                        # Format coordinates
                        coords = doc["location"]["coordinates"]
                        lat = float(coords[0])
                        lon = float(coords[1])
                        
                        # Parse operator TCKN (from value) and personId (licenseNo)
                        val = doc.get("value")
                        operator_tc = str(int(val)) if val is not None and str(val).strip() != "" else None
                        
                        person_id = doc.get("personId")
                        license_no = str(person_id) if person_id is not None and str(person_id).strip() != "" else None
                        
                        # Format params (no=4 is speed, no=632 is humidity)
                        params = []
                        speed = doc.get("speed", 0.0)
                        params.append({"no": 4, "value": float(speed)})
                        
                        humidity = doc.get("humidity")
                        if humidity is not None:
                            params.append({"no": 632, "value": float(humidity)})
                        
                        payload = {
                            "version": "1.0",
                            "MessageNu": message_no,
                            "deviceserialcode": plate,
                            "sentAt": sent_at_str,
                            "samples": [
                                {
                                    "ts": measurement_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    "lat": lat,
                                    "long": lon,      # In JSON sample: "long"
                                    "lon": lon,       # Defensively include "lon" as requested in user prompt
                                    "alt": 0.0,
                                    "heading": 0.0,
                                    "numSats": 5,
                                    "gpsValid": True,
                                    "operatorTc": operator_tc,
                                    "licenseNo": license_no,
                                    "params": params
                                }
                            ]
                        }
                        
                        # Call API
                        headers = {
                            "Content-Type": "application/json",
                            "X-API-Key": config.NOVAMETRI_API_KEY
                        }
                        
                        is_success = False
                        api_response = None
                        try:
                            print(f"Novametri Forwarder: Sending messageNo {message_no} for vehicle {plate} to Novametri...")
                            response = await client.post(config.NOVAMETRI_URL, json=payload, headers=headers)
                            
                            # Parse JSON response or save text/status
                            try:
                                api_response = response.json()
                            except Exception:
                                api_response = {"text": response.text[:1000]}
                            
                            if response.status_code in [200, 201]:
                                is_success = True
                                print(f"Novametri Forwarder: Successfully sent messageNo {message_no} for {plate}.")
                            else:
                                print(f"Novametri Forwarder: Novametri API returned status code {response.status_code} for {plate}.")
                        except Exception as post_err:
                            api_response = {"error": str(post_err)}
                            print(f"Novametri Forwarder: Failed to send post request for {plate}: {str(post_err)}")
                        
                        # Save state to novametri_messages
                        try:
                            await db["novametri_messages"].update_one(
                                {"_id": doc_id},
                                {
                                    "$set": {
                                        "messageNo": message_no,
                                        "cihazId": plate,
                                        "measurementDate": measurement_date,
                                        "isSentToNovametri": is_success,
                                        "sentTime": datetime.now(timezone.utc) if is_success else None,
                                        "apiResponse": api_response
                                    }
                                },
                                upsert=True
                            )
                        except Exception as db_err:
                            print(f"Novametri Forwarder: Failed to save status to DB for {plate}: {str(db_err)}")
                            
            except Exception as loop_err:
                print(f"Novametri Forwarder Loop Error: {str(loop_err)}")
                
            # Sleep for the configured interval
            await asyncio.sleep(config.NOVAMETRI_INTERVAL)

def start_novametri_forwarder():
    asyncio.create_task(novametri_worker_loop())
