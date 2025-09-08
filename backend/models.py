# models.py
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, func
from sqlalchemy.orm import relationship
from db import Base

class Task(Base):
    __tablename__ = "tasks"

    id         = Column(Integer, primary_key=True)
    title      = Column(String(255), nullable=False)
    notes      = Column(Text)
    freq_value = Column(Integer, nullable=False, default=1)
    freq_unit  = Column(String(16), nullable=False, default="days")  # days|weeks|months|once
    is_active  = Column(Boolean, nullable=False, default=True)

    # NEW: explicit due date for one-off tasks (UTC, stored naive)
    due_at     = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    logs = relationship("TaskLog", back_populates="task", cascade="all, delete-orphan")

class TaskLog(Base):
    __tablename__ = "task_logs"

    id       = Column(Integer, primary_key=True)
    task_id  = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False)
    title    = Column(String(255))  # denormalized snapshot of the task title
    done_at  = Column(DateTime, nullable=False, server_default=func.now())

    task = relationship("Task", back_populates="logs")
