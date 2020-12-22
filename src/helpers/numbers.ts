import BN from 'bignumber.js';

BN.config({
  ROUNDING_MODE: 0,
});

export const BigNumber = BN;

export default BigNumber;
