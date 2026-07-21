import time
from typing import Awaitable, Callable, Optional

from loguru import logger

from api.schemas.workflow_configurations import DEFAULT_MAX_CALL_DURATION_SECONDS
from pipecat.frames.frames import (
    Frame,
    HeartbeatFrame,
    InputDTMFFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    StartFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class PipelineEngineCallbacksProcessor(FrameProcessor):
    """
    Custom PipelineEngineCallbacksProcessor that accepts callbacks for various
    use cases, like ending tasks when max call duration is exceeded, or informing
    the engine that the bot is done speaking.
    """

    def __init__(
        self,
        max_call_duration_seconds: int = DEFAULT_MAX_CALL_DURATION_SECONDS,
        max_duration_end_task_callback: Optional[Callable[[], Awaitable[None]]] = None,
        generation_started_callback: Optional[Callable[[], Awaitable[None]]] = None,
        llm_text_frame_callback: Optional[Callable[[str], Awaitable[None]]] = None,
        dtmf_callback: Optional[Callable[[str], Awaitable[None]]] = None,
    ):
        super().__init__()
        self._start_time = None
        self._max_call_duration_seconds = max_call_duration_seconds
        self._max_duration_end_task_callback = max_duration_end_task_callback
        self._generation_started_callback = generation_started_callback
        self._llm_text_frame_callback = llm_text_frame_callback
        # Invoked with the raw keypad digit (e.g. "1", "#") for every
        # InputDTMFFrame. The engine uses it to deterministically fire an edge
        # when the current node is a DTMF menu node.
        self._dtmf_callback = dtmf_callback
        self._end_task_frame_pushed = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self._start(frame)
        elif isinstance(frame, HeartbeatFrame):
            await self._check_call_duration()
        elif isinstance(frame, LLMFullResponseStartFrame):
            await self._generation_started()
        elif (
            isinstance(frame, (LLMTextFrame, TTSSpeakFrame))
            and self._llm_text_frame_callback
        ):
            # Include TTSSpeakFrame here since for static nodes, we send TTSSpeakFrame
            # which can act as reference while fixing the aggregated trascript
            await self._llm_text_frame_callback(frame.text)
        elif isinstance(frame, InputDTMFFrame) and self._dtmf_callback:
            # KNOWN INTEGRATION RISK: this processor sits downstream of the
            # DTMFAggregator (gated by ENABLE_DTMF_INPUT). The raw InputDTMFFrame
            # reaches us here BEFORE the aggregator emits its
            # TranscriptionFrame("DTMF: <digits>"). We fire the deterministic
            # engine handler off the raw frame. For a dtmfMenu node the LLM has
            # no transition functions, and the deterministic set_node re-primes
            # the context, so the aggregator's later transcription is benign for
            # MVP. Revisit if DTMF ever needs to reach the LLM on the same node.
            await self._dtmf_callback(frame.button.value)

        await self.push_frame(frame, direction)

    async def _start(self, _: StartFrame):
        self._start_time = time.time()

    async def _check_call_duration(self):
        if self._start_time is not None:
            if time.time() - self._start_time > self._max_call_duration_seconds:
                if not self._end_task_frame_pushed:
                    if self._max_duration_end_task_callback:
                        await self._max_duration_end_task_callback()
                    self._end_task_frame_pushed = True
                else:
                    logger.debug(
                        "Max call duration exceeded. Skipping termination since already requested"
                    )

    async def _generation_started(self):
        if self._generation_started_callback:
            await self._generation_started_callback()
