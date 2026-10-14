from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import auth, notes, practice, video

app = FastAPI(title="Therapy practice API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router)
app.include_router(practice.router)
app.include_router(video.router)
app.include_router(notes.router)


@app.get("/api/health")
def health():
    return {"ok": True}
