"""Lyrebird driver errors."""


class LyrebirdError(RuntimeError):
    """Base error for Lyrebird operations."""


class LyrebirdApiError(LyrebirdError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        payload: object | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload
