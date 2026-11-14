from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Triage Engine API"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATABASE_URL: str
    # Comma-separated list of browser origins allowed by CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    # Static analyzer (Node). ANALYZER_DIR defaults to backend/analyzer
    ANALYZER_DIR: str | None = None
    NODE_BIN: str = "node"

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
