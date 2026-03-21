from typing import Any

try:
    from .factory import create_storyboard_deep_agent_graph
except ModuleNotFoundError as import_error:
    def create_storyboard_deep_agent_graph(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            "Deep agent runtime dependencies are unavailable. "
            "Install storyboard-agent project dependencies before invoking the graph."
        ) from import_error


__all__ = ["create_storyboard_deep_agent_graph"]
