(function () {
  'use strict';

  function initializeSidebar() {
    var sidebar = document.querySelector('[data-sidebar]');
    var backdrop = document.querySelector('[data-sidebar-backdrop]');
    var toggle = document.querySelector('[data-sidebar-toggle]');
    var closeButton = document.querySelector('[data-sidebar-close]');

    function setSidebarOpen(isOpen) {
      if (!sidebar || !backdrop) {
        return;
      }
      sidebar.classList.toggle('-translate-x-full', !isOpen);
      backdrop.classList.toggle('hidden', !isOpen);
      document.body.classList.toggle('overflow-hidden', isOpen);
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(isOpen));
      }
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        setSidebarOpen(true);
      });
    }

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        setSidebarOpen(false);
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setSidebarOpen(false);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    });
  }

  function initializeConfirmation() {
    var dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
    dialog.setAttribute('aria-describedby', 'confirm-dialog-message');
    dialog.innerHTML =
      '<div class="p-5 sm:p-6">' +
      '<div class="flex items-start gap-3">' +
      '<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>' +
      '</span>' +
      '<div class="min-w-0">' +
      '<h2 id="confirm-dialog-title" class="text-base font-semibold text-slate-900">Konfirmasi tindakan</h2>' +
      '<p id="confirm-dialog-message" class="mt-1 text-sm leading-relaxed text-slate-600"></p>' +
      '</div>' +
      '</div>' +
      '<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">' +
      '<button type="button" data-confirm-cancel class="btn btn-secondary w-full sm:w-auto">Batal</button>' +
      '<button type="button" data-confirm-accept class="btn btn-danger w-full border-rose-600 bg-rose-600 text-white hover:border-rose-700 hover:bg-rose-700 sm:w-auto">Ya, lanjutkan</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(dialog);

    var message = dialog.querySelector('#confirm-dialog-message');
    var accept = dialog.querySelector('[data-confirm-accept]');
    var cancel = dialog.querySelector('[data-confirm-cancel]');
    var pendingForm = null;

    function closeDialog() {
      pendingForm = null;
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }

    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (form.getAttribute('data-confirm-bypass') === 'true') {
          form.removeAttribute('data-confirm-bypass');
          return;
        }

        event.preventDefault();
        pendingForm = form;
        message.textContent = form.getAttribute('data-confirm') || 'Lanjutkan tindakan ini?';
        accept.textContent = form.getAttribute('data-confirm-label') || 'Ya, lanjutkan';

        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
          accept.focus();
        } else if (window.confirm(message.textContent)) {
          form.setAttribute('data-confirm-bypass', 'true');
          form.requestSubmit();
        }
      });
    });

    accept.addEventListener('click', function () {
      var form = pendingForm;
      closeDialog();
      if (form) {
        form.setAttribute('data-confirm-bypass', 'true');
        form.requestSubmit();
      }
    });

    cancel.addEventListener('click', closeDialog);

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) {
        closeDialog();
      }
    });

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeDialog();
    });
  }

  function initializeSubmitLoading() {
    document.querySelectorAll('[data-submit-loading]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (event.defaultPrevented) {
          return;
        }

        var button = form.querySelector('button[type="submit"]');
        if (!button || button.disabled) {
          return;
        }

        var originalContent = button.innerHTML;
        button.disabled = true;
        button.classList.add('cursor-wait', 'opacity-70');
        button.textContent = 'Memproses…';

        window.setTimeout(function () {
          button.disabled = false;
          button.classList.remove('cursor-wait', 'opacity-70');
          button.innerHTML = originalContent;
        }, 15000);
      });
    });
  }

  function initializeFlashDismiss() {
    document.querySelectorAll('[data-flash-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        var flash = button.closest('[data-flash]');
        if (flash && flash.parentNode) {
          flash.parentNode.removeChild(flash);
        }
      });
    });
  }

  function clearModal() {
    var container = document.getElementById('modal-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  function initializeModals() {
    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-modal-close]') : null;
      if (target) {
        clearModal();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        clearModal();
      }
    });
  }

  function initializeHtmxProgress() {
    var progress = document.getElementById('htmx-progress');
    if (!progress) {
      return;
    }

    var activeRequests = 0;

    function start(target) {
      activeRequests += 1;
      progress.classList.add('is-active');
      progress.setAttribute('aria-hidden', 'false');
      if (target) {
        target.setAttribute('aria-busy', 'true');
      }
    }

    function finish(target) {
      activeRequests = Math.max(0, activeRequests - 1);
      if (target) {
        target.removeAttribute('aria-busy');
      }
      if (activeRequests === 0) {
        progress.classList.remove('is-active');
        progress.setAttribute('aria-hidden', 'true');
      }
    }

    document.body.addEventListener('htmx:beforeRequest', function (event) {
      start(event.detail && event.detail.target);
    });
    document.body.addEventListener('htmx:afterRequest', function (event) {
      finish(event.detail && event.detail.target);
    });
    document.body.addEventListener('htmx:sendError', function (event) {
      finish(event.detail && event.detail.target);
    });
  }

  function handleHtmxErrors() {
    document.body.addEventListener('htmx:responseError', function (event) {
      var target = event.detail && event.detail.target;
      if (!target) {
        return;
      }
      target.innerHTML =
        '<div class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700" role="alert">Gagal memuat data. Silakan coba lagi.</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initializeSidebar();
    initializeConfirmation();
    initializeSubmitLoading();
    initializeFlashDismiss();
    initializeModals();
    initializeHtmxProgress();
    handleHtmxErrors();
  });
})();
