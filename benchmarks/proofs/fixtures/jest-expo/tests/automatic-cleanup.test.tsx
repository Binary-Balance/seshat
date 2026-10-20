import React, {useEffect, useState} from 'react';
import {Text} from 'react-native';
import {render, screen} from '@testing-library/react-native';
import {isPositive, start} from '../src/session';

function Session() {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const session = start();
    setStarted(session !== undefined);
    return () => session.stop();
  }, []);
  return <Text>{started ? 'started' : 'stopped'}</Text>;
}

test('starts a session', () => {
  render(<Session />);
  expect(screen.getByText('started')).toBeTruthy();
  // Testing Library's automatic afterEach must unmount even if this test fails.
});

test('checks a later mutation', () => {
  expect(isPositive(1)).toBe(true);
});
