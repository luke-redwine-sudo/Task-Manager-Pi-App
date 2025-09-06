from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from db import Base

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    freq_value = Column(Integer, nullable=False, default=1)  # e.g., 3
    freq_unit = Column(String, nullable=False, default="days")  # "hours|days|weeks"
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # two-way mapping; Task.logs <-> TaskLog.task
    logs = relationship("TaskLog", back_populates="task", cascade="all, delete-orphan")

class TaskLog(Base):
    __tablename__ = "task_logs"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    # snapshot the task title at the time of completion
    title = Column(String, nullable=True, default=None)
    done_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    task = relationship("Task", back_populates="logs")
