/* public/app.js
 *
 * The whole client-side script. Two behaviours, both progressive: the page is
 * complete without this file, and the Content-Security-Policy forbids inline
 * script, so anything of this kind has to live here.
 */

// PocketID may serve an avatar only to a signed-in browser. When the image
// fails, remove it so the first-initial circle underneath shows through
// instead of a broken-image box. `error` doesn't bubble, so listen in capture.
document.addEventListener(
  "error",
  function (event) {
    var target = event.target;
    if (target instanceof HTMLImageElement && target.hasAttribute("data-avatar")) {
      target.remove();
    }
  },
  true,
);

// Confirm destructive submits. The button carries its own prompt text, which
// keeps the wording next to the thing it destroys.
document.addEventListener("submit", function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  var prompt = form.getAttribute("data-confirm");
  if (prompt && !window.confirm(prompt)) {
    event.preventDefault();
  }
});

// Submit on change, for selects that are the whole form. The submit button
// stays in the markup, so the control still works with scripting off.
document.addEventListener("change", function (event) {
  var control = event.target;
  if (control instanceof HTMLSelectElement && control.hasAttribute("data-autosubmit")) {
    if (control.form) control.form.submit();
  }
});
