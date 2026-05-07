"""FastAPI app entry point.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Routers — DEV-A
# from routers.conversations import router as conversations_router
# from routers.branches import router as branches_router
# from routers.agent import router as agent_router

# Routers — DEV-B (uncomment at Merge 2)
# from routers.nodes import router as nodes_router
# from routers.context import router as context_router
# from routers.search import router as search_router

app = FastAPI(title="Graft API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten before deploy: list Vercel URL only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# DEV-A
# app.include_router(conversations_router, prefix="/api")
# app.include_router(branches_router, prefix="/api")
# app.include_router(agent_router, prefix="/api")

# DEV-B
# app.include_router(nodes_router, prefix="/api")
# app.include_router(context_router, prefix="/api")
# app.include_router(search_router, prefix="/api")
