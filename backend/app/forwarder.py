import asyncio
import httpx
from bson import ObjectId
from app.db import get_database
from app.routes import map_mongo_to_response
from app.models import MachineRecordResponse
from app import config

async def get_last_processed_id(db) -> ObjectId:
    state_col = db["forward_state"]
    state = await state_col.find_one({"_id": "state"})
    if state:
        try:
            return ObjectId(state["last_processed_id"])
        except Exception:
            return None
    
    # If no state exists, find the latest _id in records as the starting point.
    # This prevents forwarding the entire historical dataset on first run.
    records_col = db["records"]
    latest_record = await records_col.find_one(
        {"isDeleted": {"$ne": True}},
        sort=[("_id", -1)]
    )
    if latest_record:
        start_id = latest_record["_id"]
        # Save state
        await state_col.update_one(
            {"_id": "state"},
            {"$set": {"last_processed_id": str(start_id)}},
            upsert=True
        )
        print(f"Forwarder: Initialized state with starting _id: {start_id}")
        return start_id
    return None

async def save_last_processed_id(db, doc_id: ObjectId):
    state_col = db["forward_state"]
    await state_col.update_one(
        {"_id": "state"},
        {"$set": {"last_processed_id": str(doc_id)}},
        upsert=True
    )

async def forward_worker_loop():
    # Wait a few seconds for the app startup and DB client initialization to settle
    await asyncio.sleep(3.0)
    
    db = get_database()
    if db is None:
        print("Forwarder: Database is not ready. Skipping forwarder worker.")
        return
        
    print(f"Forwarder: Worker loop active. TARGET URL: {config.FORWARD_URL or 'NOT CONFIGURED'}")
    
    last_id = await get_last_processed_id(db)
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                if not config.FORWARD_URL:
                    await asyncio.sleep(config.FORWARD_INTERVAL)
                    continue
                    
                db = get_database()
                if db is None:
                    await asyncio.sleep(config.FORWARD_INTERVAL)
                    continue
                    
                records_col = db["records"]
                
                # Fetch new documents with _id > last_id, sorted by _id ascending
                query = {"isDeleted": {"$ne": True}}
                if last_id:
                    query["_id"] = {"$gt": last_id}
                    
                cursor = records_col.find(query).sort("_id", 1).limit(100)
                new_records = await cursor.to_list(length=100)
                
                if new_records:
                    print(f"Forwarder: Found {len(new_records)} new record(s) to forward.")
                    for doc in new_records:
                        doc_id = doc["_id"]
                        
                        # Map raw DB fields
                        mapped_dict = map_mongo_to_response(doc)
                        
                        try:
                            # Use Pydantic to validate and convert datetime/ObjectId fields to JSON-safe formats
                            model_instance = MachineRecordResponse.model_validate(mapped_dict)
                            # Dump to dict with aliases (e.g. _id) and modes="json" (datetimes to ISO strings)
                            payload = model_instance.model_dump(by_alias=True, mode="json")
                            
                            # Forward the record
                            print(f"Forwarder: Sending plate {payload.get('plate')} to {config.FORWARD_URL}")
                            response = await client.post(config.FORWARD_URL, json=payload)
                            
                            if response.status_code in [200, 201]:
                                # Success: Save status and update last_id
                                await save_last_processed_id(db, doc_id)
                                last_id = doc_id
                            else:
                                print(f"Forwarder: Server returned {response.status_code} for {doc_id}. Skipping (no retry).")
                                await save_last_processed_id(db, doc_id)
                                last_id = doc_id
                        except Exception as post_err:
                            print(f"Forwarder: Error processing/forwarding {doc_id}: {str(post_err)}. Skipping (no retry).")
                            await save_last_processed_id(db, doc_id)
                            last_id = doc_id
                            
            except Exception as loop_err:
                print(f"Forwarder loop error: {str(loop_err)}")
                
            await asyncio.sleep(config.FORWARD_INTERVAL)

def start_forwarder():
    # Run the worker task in the background
    asyncio.create_task(forward_worker_loop())
