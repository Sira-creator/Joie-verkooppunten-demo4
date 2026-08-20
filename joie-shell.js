(() => {
  "use strict";

  const backToTop = document.querySelector("[data-joie-back-to-top]");

  if (backToTop) {
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
})();
