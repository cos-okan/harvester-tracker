from motor.motor_asyncio import AsyncIOMotorClient
from app import config

class Database:
    client: AsyncIOMotorClient = None
    db = None
    allowed_plates = set()  # Set of deviceSerialCode values allowed to be displayed/forwarded

db_instance = Database()

async def load_allowed_plates():
    try:
        col = db_instance.db["defined_devices"]
        cursor = col.find({}, {"deviceSerialCode": 1})
        docs = await cursor.to_list(length=None)
        db_instance.allowed_plates = {doc["deviceSerialCode"] for doc in docs if "deviceSerialCode" in doc}
        print(f"Database: Loaded {len(db_instance.allowed_plates)} allowed plate(s): {db_instance.allowed_plates}")
    except Exception as e:
        print(f"Database: Failed to load allowed plates: {str(e)}")
        db_instance.allowed_plates = set()

async def connect_to_mongo():
    db_instance.client = AsyncIOMotorClient(config.MONGO_URL)
    db_instance.db = db_instance.client[config.DATABASE_NAME]
    print(f"Connected to MongoDB database: {config.DATABASE_NAME}")
    
    # Load whitelist of plates from defined_devices collection
    await load_allowed_plates()

async def close_mongo_connection():
    if db_instance.client:
        db_instance.client.close()
        print("Closed MongoDB connection.")

def get_database():
    return db_instance.db
