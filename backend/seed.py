from db import Base, engine, SessionLocal
from models import Task, TaskLog


Base.metadata.create_all(bind=engine)


def seed():
    db = SessionLocal()
    if db.query(Task).count() == 0:
        t1 = Task(title="Task 1", freq_value=1, freq_unit="days")
    t2 = Task(title="Task 2", freq_value=7, freq_unit="days")
    db.add_all([t1, t2])
    db.commit()
    db.close()


if __name__ == "__main__":
    seed()