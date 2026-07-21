"""Twilio frame serializer.

Subclasses pipecat's serializer to log inbound DTMF websocket events. Kept
local so transport.py imports from ``.serializers`` and we have an obvious
place for provider-specific behavior when pipecat upstream lags.
"""

import json

from loguru import logger
from pipecat.serializers.twilio import (
    TwilioFrameSerializer as _PipecatTwilioFrameSerializer,
)


class TwilioFrameSerializer(_PipecatTwilioFrameSerializer):
    """Twilio serializer with a diagnostic log on inbound DTMF websocket events.

    Twilio delivers keypad presses on a bidirectional ``<Connect><Stream>`` as a
    ``{"event": "dtmf", ...}`` message (GA since 2024-02-14; no TwiML attribute
    required). Logging it at the deserialize boundary confirms the event
    actually arrived from Twilio, independently of the downstream DTMFAggregator
    and its ``ENABLE_DTMF_INPUT`` gate — so a test call can tell "Twilio never
    sent it" apart from "it arrived but was dropped later".
    """

    async def deserialize(self, data):
        try:
            message = json.loads(data)
            if message.get("event") == "dtmf":
                digit = message.get("dtmf", {}).get("digit")
                logger.info(f"Twilio DTMF websocket event received: digit={digit!r}")
        except Exception:
            pass
        return await super().deserialize(data)


__all__ = ["TwilioFrameSerializer"]
