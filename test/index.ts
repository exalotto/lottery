import { expect } from 'chai';
import 'hardhat';

import { TicketIndexTest } from '../typechain-types';

import { deploy } from '../scripts/utils';

describe('TicketIndex', () => {
  let ticketIndex: TicketIndexTest;

  before(async () => {
    ticketIndex = await deploy('TicketIndexTest');
  });

  describe('primes', () => {
    it('0-9', async () => {
      expect(await ticketIndex.testGetPrime(0)).to.equal(1);
      expect(await ticketIndex.testGetPrime(1)).to.equal(2);
      expect(await ticketIndex.testGetPrime(2)).to.equal(3);
      expect(await ticketIndex.testGetPrime(3)).to.equal(5);
      expect(await ticketIndex.testGetPrime(4)).to.equal(7);
      expect(await ticketIndex.testGetPrime(5)).to.equal(11);
      expect(await ticketIndex.testGetPrime(6)).to.equal(13);
      expect(await ticketIndex.testGetPrime(7)).to.equal(17);
      expect(await ticketIndex.testGetPrime(8)).to.equal(19);
      expect(await ticketIndex.testGetPrime(9)).to.equal(23);
    });

    it('10-19', async () => {
      expect(await ticketIndex.testGetPrime(10)).to.equal(29);
      expect(await ticketIndex.testGetPrime(11)).to.equal(31);
      expect(await ticketIndex.testGetPrime(12)).to.equal(37);
      expect(await ticketIndex.testGetPrime(13)).to.equal(41);
      expect(await ticketIndex.testGetPrime(14)).to.equal(43);
      expect(await ticketIndex.testGetPrime(15)).to.equal(47);
      expect(await ticketIndex.testGetPrime(16)).to.equal(53);
      expect(await ticketIndex.testGetPrime(17)).to.equal(59);
      expect(await ticketIndex.testGetPrime(18)).to.equal(61);
      expect(await ticketIndex.testGetPrime(19)).to.equal(67);
    });

    it('20-29', async () => {
      expect(await ticketIndex.testGetPrime(20)).to.equal(71);
      expect(await ticketIndex.testGetPrime(21)).to.equal(73);
      expect(await ticketIndex.testGetPrime(22)).to.equal(79);
      expect(await ticketIndex.testGetPrime(23)).to.equal(83);
      expect(await ticketIndex.testGetPrime(24)).to.equal(89);
      expect(await ticketIndex.testGetPrime(25)).to.equal(97);
      expect(await ticketIndex.testGetPrime(26)).to.equal(101);
      expect(await ticketIndex.testGetPrime(27)).to.equal(103);
      expect(await ticketIndex.testGetPrime(28)).to.equal(107);
      expect(await ticketIndex.testGetPrime(29)).to.equal(109);
    });

    it('30-39', async () => {
      expect(await ticketIndex.testGetPrime(30)).to.equal(113);
      expect(await ticketIndex.testGetPrime(31)).to.equal(127);
      expect(await ticketIndex.testGetPrime(32)).to.equal(131);
      expect(await ticketIndex.testGetPrime(33)).to.equal(137);
      expect(await ticketIndex.testGetPrime(34)).to.equal(139);
      expect(await ticketIndex.testGetPrime(35)).to.equal(149);
      expect(await ticketIndex.testGetPrime(36)).to.equal(151);
      expect(await ticketIndex.testGetPrime(37)).to.equal(157);
      expect(await ticketIndex.testGetPrime(38)).to.equal(163);
      expect(await ticketIndex.testGetPrime(39)).to.equal(167);
    });

    it('40-49', async () => {
      expect(await ticketIndex.testGetPrime(40)).to.equal(173);
      expect(await ticketIndex.testGetPrime(41)).to.equal(179);
      expect(await ticketIndex.testGetPrime(42)).to.equal(181);
      expect(await ticketIndex.testGetPrime(43)).to.equal(191);
      expect(await ticketIndex.testGetPrime(44)).to.equal(193);
      expect(await ticketIndex.testGetPrime(45)).to.equal(197);
      expect(await ticketIndex.testGetPrime(46)).to.equal(199);
      expect(await ticketIndex.testGetPrime(47)).to.equal(211);
      expect(await ticketIndex.testGetPrime(48)).to.equal(223);
      expect(await ticketIndex.testGetPrime(49)).to.equal(227);
    });

    it('50-59', async () => {
      expect(await ticketIndex.testGetPrime(50)).to.equal(229);
      expect(await ticketIndex.testGetPrime(51)).to.equal(233);
      expect(await ticketIndex.testGetPrime(52)).to.equal(239);
      expect(await ticketIndex.testGetPrime(53)).to.equal(241);
      expect(await ticketIndex.testGetPrime(54)).to.equal(251);
      expect(await ticketIndex.testGetPrime(55)).to.equal(257);
      expect(await ticketIndex.testGetPrime(56)).to.equal(263);
      expect(await ticketIndex.testGetPrime(57)).to.equal(269);
      expect(await ticketIndex.testGetPrime(58)).to.equal(271);
      expect(await ticketIndex.testGetPrime(59)).to.equal(277);
    });

    it('60-69', async () => {
      expect(await ticketIndex.testGetPrime(60)).to.equal(281);
      expect(await ticketIndex.testGetPrime(61)).to.equal(283);
      expect(await ticketIndex.testGetPrime(62)).to.equal(293);
      expect(await ticketIndex.testGetPrime(63)).to.equal(307);
      expect(await ticketIndex.testGetPrime(64)).to.equal(311);
      expect(await ticketIndex.testGetPrime(65)).to.equal(313);
      expect(await ticketIndex.testGetPrime(66)).to.equal(317);
      expect(await ticketIndex.testGetPrime(67)).to.equal(331);
      expect(await ticketIndex.testGetPrime(68)).to.equal(337);
      expect(await ticketIndex.testGetPrime(69)).to.equal(347);
    });

    it('70-79', async () => {
      expect(await ticketIndex.testGetPrime(70)).to.equal(349);
      expect(await ticketIndex.testGetPrime(71)).to.equal(353);
      expect(await ticketIndex.testGetPrime(72)).to.equal(359);
      expect(await ticketIndex.testGetPrime(73)).to.equal(367);
      expect(await ticketIndex.testGetPrime(74)).to.equal(373);
      expect(await ticketIndex.testGetPrime(75)).to.equal(379);
      expect(await ticketIndex.testGetPrime(76)).to.equal(383);
      expect(await ticketIndex.testGetPrime(77)).to.equal(389);
      expect(await ticketIndex.testGetPrime(78)).to.equal(397);
      expect(await ticketIndex.testGetPrime(79)).to.equal(401);
    });

    it('80-90', async () => {
      expect(await ticketIndex.testGetPrime(80)).to.equal(409);
      expect(await ticketIndex.testGetPrime(81)).to.equal(419);
      expect(await ticketIndex.testGetPrime(82)).to.equal(421);
      expect(await ticketIndex.testGetPrime(83)).to.equal(431);
      expect(await ticketIndex.testGetPrime(84)).to.equal(433);
      expect(await ticketIndex.testGetPrime(85)).to.equal(439);
      expect(await ticketIndex.testGetPrime(86)).to.equal(443);
      expect(await ticketIndex.testGetPrime(87)).to.equal(449);
      expect(await ticketIndex.testGetPrime(88)).to.equal(457);
      expect(await ticketIndex.testGetPrime(89)).to.equal(461);
    });

    it('90-91', async () => {
      expect(await ticketIndex.testGetPrime(90)).to.equal(463);
      await expect(ticketIndex.testGetPrime(91)).to.be.reverted;
    });
  });
});
