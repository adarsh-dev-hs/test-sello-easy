from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    app_secret_key: str = "change-me"
    jwt_expire_minutes: int = 1440
    file_url_signing_key: str = "change-me-too"
    public_backend_url: str = "http://backend:8000"
    cors_origins: str = "http://localhost:5173"
    upload_dir: str = "/data/uploads"

    seed_demo: bool = True
    demo_user_email: str = "demo@selloeasy.local"
    demo_user_password: str = "demo1234"
    demo_assets_dir: str = "/demo/docs"
    demo_sites_base_url: str = "http://demo-sites"

    database_url: str = "postgresql+asyncpg://selloeasy:selloeasy@postgres:5432/selloeasy"
    redis_url: str = "redis://redis:6379/0"

    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    openai_model_cheap: str = "gpt-5-nano"
    openai_model_qualify: str = ""  # lead qualification model; empty = OPENAI_MODEL
    llm_max_concurrency: int = 4

    mcp_config_path: str = "/app/mcp_servers.yaml"
    mcp_shared_token: str = ""
    mcp_call_timeout_seconds: int = 60
    max_mcp_calls_per_run: int = 150
    max_llm_calls_per_run: int = 80
    signal_run_interval_hours: int = 0  # 0 = manual runs only

    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "SelloEasy Demo <demo@selloeasy.local>"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
