from __future__ import annotations

import json
import os
import subprocess
import sys


def test_cli_json_round_trip(tmp_path, cookie_request: dict[str, object]) -> None:
    request_file = tmp_path / "request.json"
    request_file.write_text(json.dumps(cookie_request, ensure_ascii=False), encoding="utf-8")
    env = os.environ.copy()
    src = str(tmp_path.parents[1] / "src")
    # 実行中のテスト環境と同じsrcを、サブプロセスへ明示的に渡す。
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [os.environ.get("PYTHONPATH"), src]))
    completed = subprocess.run(
        [sys.executable, "-m", "nutrition_estimator", "estimate", str(request_file), "--samples", "300"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["status"] == "completed"
    assert set(result["estimates"]) == {"fiberG", "saturatedFatG"}
