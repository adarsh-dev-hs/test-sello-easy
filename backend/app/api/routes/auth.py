from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.serializers import user_out
from app.db import get_session
from app.models import User
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


def _token(user: User) -> dict:
    return {"access_token": create_access_token(user.id), "token_type": "bearer", "user": user_out(user)}


@router.post("/register")
async def register(body: RegisterIn, session: AsyncSession = Depends(get_session)):
    email = body.email.lower()
    if await session.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(409, "Email already registered")
    user = User(email=email, name=body.name or email.split("@")[0], password_hash=hash_password(body.password))
    session.add(user)
    await session.commit()
    return _token(user)


@router.post("/login")
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    user = await session.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    return _token(user)


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return user_out(user)
