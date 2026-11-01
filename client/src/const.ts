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
    window.alert("Sign-in is not available on this screen. Open the workspace and use the Sign in button.");
  }
};
