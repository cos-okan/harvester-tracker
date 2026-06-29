from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.db import connect_to_mongo, close_mongo_connection
from app.routes import router
from app.forwarder import start_forwarder
from app import config

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB
    await connect_to_mongo()
    
    # Start background data forwarder
    start_forwarder()
    
    yield
    # Shutdown: Close MongoDB connection
    await close_mongo_connection()

app = FastAPI(
    title="Harvester Tracker API",
    description="Biçerdöverlerin canlı takibi ve hız ihlallerini raporlayan MVP API katmanı",
    version="1.0.0",
    lifespan=lifespan
)

# CORS ayarları - React frontend'in bağlanabilmesi için
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
async def root():
    return {
        "message": "Harvester Tracker API is active",
        "docs": "/docs",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=True)
