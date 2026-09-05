import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
export { COOKIE_NAME, ONE_YEAR_MS };

let _loginCallback: (() => void) | null = null;

export const setOnLoginRequest = (cb: () => void) => {
  _loginCallback = cb;
};

export const startLogin = () => {
  if (_loginCallback) {
    _loginCallback();
  } else {
    const email = window.prompt("Enter your email to sign in to VerityLens:", "reviewer@institution.com");
    if (email) {
      window.location.reload();
    }
  }
};
