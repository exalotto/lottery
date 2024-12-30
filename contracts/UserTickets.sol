// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./TicketIndex.sol";

struct TicketData {
  /// @dev This is not properly a "hash": it's calculated by multiplying the prime numbers
  ///   corresponding to the numbers of the ticket. See the note on `TicketIndex` for more details.
  ///   The resulting value allows retrieving all the numbers in the ticket and it's more efficient
  ///   than storing them separately.
  uint256 hash;
  /// @dev The block number of the transaction that created the ticket.
  uint128 blockNumber;
  /// @dev The unique incremental ID of the ticket (it's unique even across rounds).
  uint64 id;
  /// @dev The round number of the ticket.
  uint32 round;
  /// @dev The number of numbers in the ticket, e.g. 6 for a 6-number ticket. Note that `hash` is
  ///   the product of `cardinality` different primes.
  uint16 cardinality;
  /// @dev Whether or not the prize attributed to the ticket has been withdrawn by the user.
  bool withdrawn;
}

error InvalidTicketIdError(uint ticketId);

library UserTickets {
  function _lowerBound(TicketData[] storage tickets, uint round) private view returns (uint) {
    uint i = 0;
    uint j = tickets.length;
    while (j > i) {
      uint k = i + ((j - i) >> 1);
      if (round > tickets[k].round) {
        i = k + 1;
      } else {
        j = k;
      }
    }
    return i;
  }

  function _upperBound(TicketData[] storage tickets, uint round) private view returns (uint) {
    uint i = 0;
    uint j = tickets.length;
    while (j > i) {
      uint k = i + ((j - i) >> 1);
      if (round < tickets[k].round) {
        j = k;
      } else {
        i = k + 1;
      }
    }
    return j;
  }

  function getTicketIds(TicketData[] storage tickets) public view returns (uint[] memory ids) {
    ids = new uint[](tickets.length);
    for (uint i = 0; i < tickets.length; i++) {
      ids[i] = tickets[i].id;
    }
  }

  function getTicketIdsForRound(
    TicketData[] storage tickets,
    uint round
  ) public view returns (uint[] memory ids) {
    uint min = _lowerBound(tickets, round);
    uint max = _upperBound(tickets, round);
    if (max < min) {
      max = min;
    }
    ids = new uint[](max - min);
    for (uint i = min; i < max; i++) {
      ids[i - min] = tickets[i].id;
    }
  }

  function getTicket(
    TicketData[] storage tickets,
    uint ticketId
  ) public view returns (TicketData storage) {
    uint i = 0;
    uint j = tickets.length;
    while (j > i) {
      uint k = i + ((j - i) >> 1);
      if (ticketId < tickets[k].id) {
        j = k;
      } else if (ticketId > tickets[k].id) {
        i = k + 1;
      } else {
        return tickets[k];
      }
    }
    revert InvalidTicketIdError(ticketId);
  }

  function _getTicketNumbers(
    TicketData storage ticket
  ) private view returns (uint8[] memory numbers) {
    numbers = new uint8[](ticket.cardinality);
    uint i = 0;
    for (uint8 j = 1; j <= 90; j++) {
      if (ticket.hash % TicketIndex.getPrime(j) == 0) {
        numbers[i++] = j;
      }
    }
  }

  function getTicketAndNumbers(
    TicketData[] storage tickets,
    uint ticketId
  ) public view returns (TicketData storage, uint8[] memory numbers) {
    TicketData storage ticket = getTicket(tickets, ticketId);
    return (ticket, _getTicketNumbers(ticket));
  }
}
