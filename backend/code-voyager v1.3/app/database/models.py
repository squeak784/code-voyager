from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text, LargeBinary, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    projects: Mapped[list["Project"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    directory_path: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    analysis: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    revisions: Mapped[list["FileRevision"]] = relationship(cascade="all, delete-orphan")
    rag_index: Mapped["RagIndex | None"] = relationship(cascade="all, delete-orphan", uselist=False)
    chat_turns: Mapped[list["ChatTurn"]] = relationship(cascade="all, delete-orphan")

    owner: Mapped[User] = relationship(
        back_populates="projects",
    )

class FileRevision(Base):
    """Previous file bytes. Kept outside project folders and ZIP exports."""
    __tablename__ = "file_revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    path: Mapped[str] = mapped_column(Text)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RagIndex(Base):
    __tablename__ = 'rag_indexes'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    indexed_revision: Mapped[int] = mapped_column(Integer, default=-1)
    generation: Mapped[str] = mapped_column(String(36), default='')
    status: Mapped[str] = mapped_column(String(20), default='queued')
    phase: Mapped[str] = mapped_column(String(100), default='В очереди')
    completed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[str] = mapped_column(Text, default='[]')
    manifest: Mapped[str] = mapped_column(Text, default='{}')
    error: Mapped[str] = mapped_column(Text, default='')
    pipeline: Mapped[str] = mapped_column(String(100), default='')
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatTurn(Base):
    __tablename__ = 'chat_turns'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default='')
    status: Mapped[str] = mapped_column(String(20), default='running')
    error: Mapped[str] = mapped_column(Text, default='')
    sources: Mapped[str] = mapped_column(Text, default='[]')
    generation: Mapped[str] = mapped_column(String(36), default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
