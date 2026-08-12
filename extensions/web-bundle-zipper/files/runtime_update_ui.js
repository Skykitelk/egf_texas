/**
 * Runtime 版本更新：强制英文确认模态 + 更新动画 overlay
 */
(function (global) {
    const MODAL_ID = 'bz-runtime-update-modal';
    const OVERLAY_ID = 'bz-runtime-update-overlay';

    function ensureDom() {
        if (global.document.getElementById(MODAL_ID)) {
            return;
        }
        const wrap = global.document.createElement('div');
        wrap.innerHTML =
            '<div id="' +
            MODAL_ID +
            '" class="bz-hidden" role="dialog" aria-modal="true">' +
            '<div class="bz-modal-panel">' +
            '<p class="bz-modal-message">A new version is available. Update now?</p>' +
            '<div class="bz-modal-actions">' +
            '<button type="button" id="bz-update-now">Update Now</button>' +
            '</div></div></div>' +
            '<div id="' +
            OVERLAY_ID +
            '" class="bz-hidden">' +
            '<div class="bz-spinner" aria-label="Updating"></div>' +
            '<p class="bz-update-status">Updating...</p>' +
            '<div class="bz-update-progress"><span style="width:0%"></span></div>' +
            '<button type="button" id="bz-update-retry" class="bz-hidden">Retry</button>' +
            '</div>';
        while (wrap.firstChild) {
            global.document.body.appendChild(wrap.firstChild);
        }
        ensureRetryButton();
    }

    function ensureRetryButton() {
        const overlay = getOverlay();
        if (!overlay || global.document.getElementById('bz-update-retry')) {
            return;
        }
        const retryBtn = global.document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.id = 'bz-update-retry';
        retryBtn.className = 'bz-hidden';
        retryBtn.textContent = 'Retry';
        overlay.appendChild(retryBtn);
    }

    function getModal() {
        return global.document.getElementById(MODAL_ID);
    }

    function getOverlay() {
        return global.document.getElementById(OVERLAY_ID);
    }

    function showRuntimeUpdateModal() {
        ensureDom();
        return new Promise(function (resolve) {
            const modal = getModal();
            const nowBtn = global.document.getElementById('bz-update-now');
            if (!modal || !nowBtn) {
                resolve('reload');
                return;
            }

            function cleanup() {
                modal.classList.add('bz-hidden');
                nowBtn.removeEventListener('click', onNow);
            }

            function onNow() {
                cleanup();
                resolve('reload');
            }

            nowBtn.addEventListener('click', onNow);
            modal.classList.remove('bz-hidden');
        });
    }

    function resetRuntimeUpdateOverlay() {
        ensureDom();
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        overlay.classList.remove('bz-update-failed');
        const spinner = overlay.querySelector('.bz-spinner');
        const progress = overlay.querySelector('.bz-update-progress');
        const retryBtn = global.document.getElementById('bz-update-retry');
        if (spinner) {
            spinner.classList.remove('bz-hidden');
        }
        if (progress) {
            progress.classList.remove('bz-hidden');
        }
        if (retryBtn) {
            retryBtn.classList.add('bz-hidden');
        }
        setRuntimeUpdateProgress(0);
        setRuntimeUpdateStatus('Updating...');
    }

    function showRuntimeUpdateOverlay() {
        ensureDom();
        const overlay = getOverlay();
        if (overlay) {
            overlay.classList.remove('bz-hidden');
            resetRuntimeUpdateOverlay();
        }
    }

    function hideRuntimeUpdateOverlay() {
        const overlay = getOverlay();
        if (overlay) {
            overlay.classList.add('bz-hidden');
        }
    }

    function setRuntimeUpdateProgress(percent) {
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        const bar = overlay.querySelector('.bz-update-progress span');
        if (bar) {
            const value = Math.max(0, Math.min(100, percent));
            bar.style.width = value.toFixed(1) + '%';
        }
    }

    function setRuntimeUpdateStatus(text) {
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        const status = overlay.querySelector('.bz-update-status');
        if (status) {
            status.textContent = text || 'Updating...';
        }
    }

    function showRuntimeUpdateError(message) {
        ensureDom();
        return new Promise(function (resolve) {
            const overlay = getOverlay();
            const retryBtn = global.document.getElementById('bz-update-retry');
            if (!overlay || !retryBtn) {
                resolve();
                return;
            }

            overlay.classList.add('bz-update-failed');
            const spinner = overlay.querySelector('.bz-spinner');
            const progress = overlay.querySelector('.bz-update-progress');
            if (spinner) {
                spinner.classList.add('bz-hidden');
            }
            if (progress) {
                progress.classList.add('bz-hidden');
            }
            setRuntimeUpdateStatus(message || 'Update failed. Please try again.');
            retryBtn.classList.remove('bz-hidden');

            function onRetry() {
                retryBtn.removeEventListener('click', onRetry);
                resolve();
            }

            retryBtn.addEventListener('click', onRetry);
        });
    }

    global.BundleZipperRuntimeUI = {
        ensureDom: ensureDom,
        showRuntimeUpdateModal: showRuntimeUpdateModal,
        showRuntimeUpdateOverlay: showRuntimeUpdateOverlay,
        hideRuntimeUpdateOverlay: hideRuntimeUpdateOverlay,
        resetRuntimeUpdateOverlay: resetRuntimeUpdateOverlay,
        setRuntimeUpdateProgress: setRuntimeUpdateProgress,
        setRuntimeUpdateStatus: setRuntimeUpdateStatus,
        showRuntimeUpdateError: showRuntimeUpdateError,
    };
})(typeof window !== 'undefined' ? window : self);
