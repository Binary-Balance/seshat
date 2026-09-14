import {answer} from '@seshat/example-rules';

export const adult = (age: number) => age >= 18;

export function workspaceAnswer() {
  return answer();
}
