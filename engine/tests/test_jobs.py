"""Job framework: lifecycle, progress, failure, cancellation, child processes."""

import os
import threading
import time

from pydantic import BaseModel

from pdfengine.errors import EngineError
from pdfengine.jobs import JobContext, JobType
from pdfengine.worker import run_in_process

# --- Job types used only by these tests ---------------------------------------


class StepsParams(BaseModel):
    steps: int = 5
    delay: float = 0.02
    fail_at: int | None = None


def run_steps(context: JobContext, params: StepsParams) -> dict:
    seen = []
    for step in range(params.steps):
        context.check()
        if params.fail_at == step:
            raise EngineError("broken_step", f"Step {step} could not be done.", 422)
        context.progress((step + 1) / params.steps, f"Step {step + 1} of {params.steps}")
        seen.append(round((step + 1) / params.steps, 2))
        time.sleep(params.delay)
    return {"steps": params.steps, "seen": seen}


class Crash(BaseModel):
    pass


def run_crash(context: JobContext, params: Crash) -> dict:
    raise RuntimeError("unexpected")


class ChildParams(BaseModel):
    seconds: float = 0.0
    fail: bool = False


def child_sleeper(payload: dict, report) -> dict:
    """Runs in a child process."""
    if payload["fail"]:
        raise EngineError("child_said_no", "The child refused.", 400)
    steps = 10
    for step in range(steps):
        report((step + 1) / steps, f"Child step {step + 1}")
        time.sleep(payload["seconds"] / steps)
    return {"pid": os.getpid(), "done": True}


def run_child(context: JobContext, params: ChildParams) -> dict:
    return run_in_process(
        context,
        "tests.test_jobs:child_sleeper",
        {"seconds": params.seconds, "fail": params.fail},
        span=(0.1, 0.9),
    )


def register(app) -> None:
    jobs = app.state.jobs
    jobs.register(JobType("test-steps", StepsParams, run_steps, document="none"))
    jobs.register(JobType("test-crash", Crash, run_crash, document="none"))
    jobs.register(JobType("test-child", ChildParams, run_child, document="none"))
    jobs.register(
        JobType("test-doc", StepsParams, run_steps, document="required", changes_document=True)
    )


# --- Tests ------------------------------------------------------------------------


def test_job_runs_to_done_with_rising_progress(app, client):
    register(app)
    started = client.post(
        "/v1/jobs", json={"type": "test-steps", "params": {"steps": 8, "delay": 0.03}}
    ).json()
    assert started["status"] in ("queued", "running")
    progress = []
    while True:
        status = client.get(f"/v1/jobs/{started['jobId']}").json()
        progress.append(status["progress"])
        if status["status"] == "done":
            break
        time.sleep(0.01)
    assert progress == sorted(progress)
    assert status["progress"] == 1.0
    assert status["result"]["steps"] == 8
    assert status["result"]["seen"] == sorted(status["result"]["seen"])


def test_failed_job_reports_a_readable_error(app, run_job):
    register(app)
    status = run_job("test-steps", None, {"steps": 5, "fail_at": 2})
    assert status["status"] == "failed"
    assert status["error"] == {"code": "broken_step", "message": "Step 2 could not be done."}


def test_unexpected_exception_becomes_internal_error(app, run_job):
    register(app)
    status = run_job("test-crash", None, {})
    assert status["status"] == "failed"
    assert status["error"]["code"] == "internal_error"
    assert "unexpected" in status["error"]["message"]


def test_cancel_stops_the_job(app, client):
    register(app)
    job_id = client.post(
        "/v1/jobs", json={"type": "test-steps", "params": {"steps": 200, "delay": 0.02}}
    ).json()["jobId"]
    time.sleep(0.1)
    cancelled = client.post(f"/v1/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    status = app.state.jobs.wait(job_id, timeout=5)
    assert status["status"] == "cancelled"
    assert status["progress"] < 1.0


def test_unknown_job_and_bad_params(app, client):
    register(app)
    response = client.post("/v1/jobs", json={"type": "nope", "params": {}})
    assert response.status_code == 400
    response = client.post("/v1/jobs", json={"type": "test-steps", "params": {"steps": "many"}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert client.get("/v1/jobs/does-not-exist").status_code == 404


def test_document_jobs_need_a_document_and_do_not_overlap(app, client, sample_pdf, open_doc):
    register(app)
    assert client.post("/v1/jobs", json={"type": "test-doc", "params": {}}).status_code == 400
    doc_id = open_doc(sample_pdf)["docId"]
    first = client.post(
        "/v1/jobs",
        json={"type": "test-doc", "docId": doc_id, "params": {"steps": 100, "delay": 0.02}},
    )
    assert first.status_code == 200
    second = client.post(
        "/v1/jobs", json={"type": "test-doc", "docId": doc_id, "params": {"steps": 1}}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "job_running"
    # Closing the document cancels its job.
    client.delete(f"/v1/docs/{doc_id}")
    status = app.state.jobs.wait(first.json()["jobId"], timeout=5)
    assert status["status"] == "cancelled"


def test_child_process_job_reports_progress_and_result(app, run_job):
    register(app)
    status = run_job("test-child", None, {"seconds": 0.2})
    assert status["status"] == "done", status
    assert status["result"]["done"] is True
    assert status["result"]["pid"] != os.getpid()


def test_child_process_error_is_reported(app, run_job):
    register(app)
    status = run_job("test-child", None, {"fail": True})
    assert status["status"] == "failed"
    assert status["error"]["code"] == "child_said_no"


def test_cancelling_a_child_process_job_terminates_it(app, client):
    register(app)
    job_id = client.post("/v1/jobs", json={"type": "test-child", "params": {"seconds": 30}}).json()[
        "jobId"
    ]
    # Wait until the child is up and reporting.
    deadline = time.monotonic() + 30
    while client.get(f"/v1/jobs/{job_id}").json()["progress"] <= 0.1:
        assert time.monotonic() < deadline
        time.sleep(0.05)
    started = time.monotonic()
    client.post(f"/v1/jobs/{job_id}/cancel")
    status = app.state.jobs.wait(job_id, timeout=10)
    assert status["status"] == "cancelled"
    assert time.monotonic() - started < 5
    alive = [t for t in threading.enumerate() if t.name.startswith("job-test-child")]
    assert alive == [] or all(not t.is_alive() for t in alive)
