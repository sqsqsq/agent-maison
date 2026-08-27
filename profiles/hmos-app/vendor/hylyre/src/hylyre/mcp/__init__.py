"""Thin MCP server wrapper (P5+). Pyproject extra: pip install 'hylyre[mcp]'."""

from hylyre.mcp.server import build_mcp, serve_stdio

__all__ = ["build_mcp", "serve_stdio"]
