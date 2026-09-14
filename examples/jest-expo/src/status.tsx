import React from 'react';
import {Text} from 'react-native';

export function classify(age: number) {
  if (age >= 18) return 'adult';
  return 'minor';
}

export function isPositive(value: number) {
  return value > 0;
}

export function statusCard(age: number) {
  return <Text>{classify(age)}</Text>;
}
