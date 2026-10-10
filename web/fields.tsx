import React from 'react';

export function TopicWeightInput({ label, value, onChange }: {
  label: string; value: number; onChange: (value: number) => void;
}) {
  return <label>{label}<input type="number" min="0" max="3" step="any" value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}
