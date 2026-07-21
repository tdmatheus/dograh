from typing import Awaitable, Callable

from loguru import logger

from pipecat.frames.frames import Frame, InputDTMFFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class DTMFInputProcessor(FrameProcessor):
    """Fires an engine callback for each keypad digit, at the pipeline's head.

    Placed immediately after ``transport.input()`` — the source of
    ``InputDTMFFrame`` — so a keyed digit is delivered to the engine before any
    downstream service (STT, context aggregator, LLM) has a chance to consume or
    drop the frame. This is what makes deterministic DTMF-menu routing reliable:
    a late processor can't assume a raw ``InputDTMFFrame`` survives traversal
    through the LLM, but a head-of-pipeline one always sees it.

    The frame is still pushed downstream unchanged, so the ``DTMFAggregator``
    that follows continues to emit its ``"DTMF: <digits>"`` transcription.
    """

    def __init__(self, dtmf_callback: Callable[[str], Awaitable[None]]):
        super().__init__()
        self._dtmf_callback = dtmf_callback

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputDTMFFrame):
            logger.info(f"DTMF input frame received: digit={frame.button.value!r}")
            await self._dtmf_callback(frame.button.value)

        await self.push_frame(frame, direction)
