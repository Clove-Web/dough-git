/* public/app.js
 * LICENCED DASL-1.0 (c) Clove Twilight
 */

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

document.addEventListener("submit", function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  var prompt = form.getAttribute("data-confirm");
  if (prompt && !window.confirm(prompt)) {
    event.preventDefault();
  }
});

document.addEventListener("change", function (event) {
  var control = event.target;
  if (control instanceof HTMLSelectElement && control.hasAttribute("data-autosubmit")) {
    if (control.form) control.form.submit();
  }
});
