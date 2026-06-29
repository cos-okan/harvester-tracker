from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class LocationSchema(BaseModel):
    type: str = "Point"
    coordinates: List[float] # [latitude, longitude]

class MachineRecordResponse(BaseModel):
    id: str = Field(..., alias="_id")
    measurementDate: datetime
    plate: str
    personId: Optional[str] = None
    driverTCKN: Optional[int] = None
    speed: Optional[float] = 0.0
    humidity: Optional[float] = None
    location: LocationSchema
    areaName: Optional[str] = None
    areaCode: Optional[int] = None
    parcelNo: Optional[str] = None
    pafta: Optional[str] = None
    adaNo: Optional[str] = None
    parcelArea: Optional[float] = None
    isActive: bool = True
    isSpeeding: bool = False
    seedType: Optional[str] = None

    class Config:
        populate_by_name = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
