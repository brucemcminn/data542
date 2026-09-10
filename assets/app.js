/* data542.com — app.js
   Minimal JS — the accordion is pure HTML/CSS.
   This file is here for future use (e.g. Power BI embed tokens,
   contact form handling, analytics). */

document.addEventListener('DOMContentLoaded', () => {

  // Close other open accordions when one opens (optional UX polish)
  const details = document.querySelectorAll('details.project-item');
  details.forEach(detail => {
    detail.addEventListener('toggle', () => {
      if (detail.open) {
        details.forEach(other => {
          if (other !== detail && other.open) {
            other.removeAttribute('open');
          }
        });
      }
    });
  });

});