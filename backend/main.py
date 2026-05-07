from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.nodes import router as nodes_router
from routers.context import router as context_router
from routers.search import router as search_router

app = FastAPI(title="Graft API", description="Git for agent conversations")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(nodes_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(search_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
