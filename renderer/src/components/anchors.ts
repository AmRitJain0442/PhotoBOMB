import type React from 'react';
import type {Anchor} from '../edl/schema';

// IG UI margins: 12% top / 20% bottom / 10% right (PRD F5). Values chosen
// to sit just inside those margins.
export const anchorStyle = (anchor: Anchor): React.CSSProperties => {
  switch (anchor) {
    case 'lower_third':
      return {position: 'absolute', left: '8%', right: '12%', bottom: '22%', textAlign: 'left'};
    case 'center':
      return {
        position: 'absolute',
        left: '10%',
        right: '12%',
        top: '50%',
        transform: 'translateY(-50%)',
        textAlign: 'center',
      };
    case 'upper_safe':
      return {position: 'absolute', left: '8%', right: '12%', top: '14%', textAlign: 'left'};
    case 'corner_br':
      return {position: 'absolute', right: '12%', bottom: '22%', textAlign: 'right'};
  }
};
