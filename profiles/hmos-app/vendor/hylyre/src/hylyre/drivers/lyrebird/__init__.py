"""Lyrebird mock driver (optional `pip install 'hylyre[mock]'` for subprocess start)."""

from hylyre.drivers.lyrebird.cert_bootstrap import mitm_trust_instructions
from hylyre.drivers.lyrebird.controller import LyrebirdController, require_lyrebird_distribution
from hylyre.drivers.lyrebird.exceptions import LyrebirdApiError, LyrebirdError

__all__ = [
    "LyrebirdApiError",
    "LyrebirdController",
    "LyrebirdError",
    "mitm_trust_instructions",
    "require_lyrebird_distribution",
]
