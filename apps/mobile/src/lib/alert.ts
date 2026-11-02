import { Alert as NativeAlert, Platform, type AlertButton } from 'react-native';

/**
 * Drop-in replacement for React Native's Alert that also works in the browser.
 * react-native-web's Alert.alert does nothing, which made validation and error messages invisible
 * in the web app. On web: no/one button → window.alert; cancel + one action → window.confirm;
 * several actions → a numbered window.prompt.
 */
function webAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const text = [title, message].filter(Boolean).join('\n\n');
  const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
  const cancel = (buttons ?? []).find((b) => b.style === 'cancel');
  if (actions.length <= 1 && !cancel) {
    window.alert(text);
    actions[0]?.onPress?.();
    return;
  }
  if (actions.length === 1) {
    if (window.confirm(`${text}\n\nOK = ${actions[0]!.text ?? 'OK'}`)) actions[0]!.onPress?.();
    else cancel?.onPress?.();
    return;
  }
  const list = actions.map((b, i) => `${i + 1}. ${b.text}`).join('\n');
  const answer = window.prompt(`${text}\n\n${list}\n\nType a number:`);
  const chosen = answer ? actions[Number.parseInt(answer, 10) - 1] : undefined;
  if (chosen) chosen.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (Platform.OS === 'web') webAlert(title, message, buttons);
    else NativeAlert.alert(title, message, buttons);
  },
};
