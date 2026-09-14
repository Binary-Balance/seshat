import {Text} from 'react-native';
import {classify, isPositive, statusCard} from '../src/status';

test('covers both classification boundaries', () => {
  expect(classify(18)).toBe('adult');
  expect(classify(17)).toBe('minor');
});

test('covers the intentionally surviving positive boundary', () => {
  expect(isPositive(1)).toBe(true);
});

test('renders the Expo text element', () => {
  const element = statusCard(18);
  expect(element.type).toBe(Text);
  expect(element.props.children).toBe('adult');
});
