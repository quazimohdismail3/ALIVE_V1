"""RR-derived respiratory frequency via Welch PSD on RSA oscillation."""
import numpy as np
from scipy.signal import welch
from scipy.interpolate import interp1d


class RFEngine:
    RESAMPLE_HZ = 4          # uniform grid for spectral analysis
    SEARCH_LO   = 0.07       # Hz = 4.2 BPM (covers full 4.5+ BPM range with margin)
    SEARCH_HI   = 0.40       # Hz = 24 BPM
    MIN_WINDOW_S = 30        # minimum clean data for live session RF
    CAL_WINDOW_S = 90        # minimum for calibration (6 cycles at 4.5 BPM)

    def __init__(self):
        self._rr_ms: list[float] = []
        self._timestamps: list[float] = []
        self._elapsed: float = 0.0

    def push_rr(self, rr_ms: float) -> None:
        """Called once per incoming RR interval. Maintains rolling buffer."""
        self._rr_ms.append(rr_ms)
        self._elapsed += rr_ms / 1000.0
        # Keep only last CAL_WINDOW_S seconds
        while self._elapsed > self.CAL_WINDOW_S and len(self._rr_ms) > 1:
            self._elapsed -= self._rr_ms.pop(0) / 1000.0

    def compute_rf(self, window_s: float = None) -> float | None:
        """
        Returns RF in Hz. None if insufficient data.
        window_s=30 for live session, window_s=90 for calibration.
        """
        # UNTUNED: peak detection threshold not validated on real H10 data
        if window_s is None:
            window_s = self.MIN_WINDOW_S
        if self._elapsed < window_s or len(self._rr_ms) < 20:
            return None
        resampled = self._resample()
        if resampled is None:
            return None
        freqs, psd = welch(resampled, fs=self.RESAMPLE_HZ, nperseg=min(256, len(resampled)))
        mask = (freqs >= self.SEARCH_LO) & (freqs <= self.SEARCH_HI)
        if not mask.any():
            return None
        peak_freq = freqs[mask][np.argmax(psd[mask])]
        return float(peak_freq)

    def as_resp_signal(self) -> np.ndarray:
        """
        Synthetic respiratory signal derived from RR series via bandpass.
        Plugs into rf_calibration.compute_coherence_at_frequency() as resp_buffer
        when H10 accelerometer is unavailable (current state of Mode 2).
        """
        resampled = self._resample()
        if resampled is None:
            return np.array([])
        from scipy.signal import butter, filtfilt
        b, a = butter(2, [self.SEARCH_LO, self.SEARCH_HI],
                      btype='band', fs=self.RESAMPLE_HZ)
        return filtfilt(b, a, resampled)

    def _resample(self) -> np.ndarray | None:
        if len(self._rr_ms) < 10:
            return None
        rr_s = np.array(self._rr_ms) / 1000.0
        cumtime = np.cumsum(rr_s)
        if cumtime[-1] < 10:
            return None
        uniform_t = np.arange(0, cumtime[-1], 1.0 / self.RESAMPLE_HZ)
        interpolator = interp1d(cumtime, rr_s, kind='linear', bounds_error=False,
                                fill_value=(rr_s[0], rr_s[-1]))
        return interpolator(uniform_t)
