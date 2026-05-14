from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.nodes import router as nodes_router
from routers.context import router as context_router
from routers.search import router as search_router
from routers.conversations import router as conversations_router
from routers.branches import router as branches_router
from routers.agent import router as agent_router
from routers.export import router as export_router
from routers.users import router as users_router
from routers.tags import router as tags_router

app = FastAPI(title="Graft API", description="Git for agent conversations")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
    ],
    # Match any Vercel deployment URL (production + previews). Tighten to an
    # explicit list once a stable custom domain is in place.
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(nodes_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(branches_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(tags_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
