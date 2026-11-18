import test, { describe } from 'node:test';
import assert from 'node:assert';
import {
  effectiveStatus,
  normalizeSearchToken,
  matchesFlightSearch,
  fmtFlightTime,
  fmtFlightDateTime,
  formatDelayMinutes,
  getFlightStatusMeta,
  groupFlights,
  groupNationalFlights,
  timelineStepIndex,
  isStatusInterrupted,
  formatRouteDisplay,
  BoardFlight,
  NationalFlight,
  CachedStatus,
} from './flightRadarLogic';
import { canAccessTab } from './permissions';
import { User } from './types';

describe('Flight Radar Logic & Formatting (Grok UI)', () => {
  describe('effectiveStatus', () => {
    test('returns unknown for null or empty status', () => {
      assert.strictEqual(effectiveStatus(null), 'unknown');
      assert.strictEqual(effectiveStatus(undefined), 'unknown');
      assert.strictEqual(effectiveStatus({ status: '' } as CachedStatus), 'unknown');
    });

    test('maps diverted to returned when landing matches departure airport', () => {
      const returned: CachedStatus = {
        status: 'diverted',
        scheduled_departure: null,
        actual_departure: null,
        scheduled_arrival: null,
        actual_arrival: null,
        delay_minutes: null,
        departure_airport: 'LOS',
        arrival_airport: 'KAN',
        diverted_airport: 'LOS',
      };
      assert.strictEqual(effectiveStatus(returned), 'returned');
    });

    test('retains diverted when landing is a third airport', () => {
      const diverted: CachedStatus = {
        status: 'diverted',
        scheduled_departure: null,
        actual_departure: null,
        scheduled_arrival: null,
        actual_arrival: null,
        delay_minutes: null,
        departure_airport: 'LOS',
        arrival_airport: 'KAN',
        diverted_airport: 'ABV',
      };
      assert.strictEqual(effectiveStatus(diverted), 'diverted');
    });

    test('returns standard flight statuses correctly', () => {
      const makeStatus = (status: string): CachedStatus => ({
        status,
        scheduled_departure: null,
        actual_departure: null,
        scheduled_arrival: null,
        actual_arrival: null,
        delay_minutes: null,
        departure_airport: 'LOS',
        arrival_airport: 'ABV',
        diverted_airport: null,
      });

      assert.strictEqual(effectiveStatus(makeStatus('scheduled')), 'scheduled');
      assert.strictEqual(effectiveStatus(makeStatus('boarding')), 'boarding');
      assert.strictEqual(effectiveStatus(makeStatus('departed')), 'departed');
      assert.strictEqual(effectiveStatus(makeStatus('delayed')), 'delayed');
      assert.strictEqual(effectiveStatus(makeStatus('cancelled')), 'cancelled');
      assert.strictEqual(effectiveStatus(makeStatus('landed')), 'landed');
      assert.strictEqual(effectiveStatus(makeStatus('other-unknown')), 'unknown');
    });
  });

  describe('normalizeSearchToken & matchesFlightSearch', () => {
    test('strips punctuation, whitespace, and normalizes casing', () => {
      assert.strictEqual(normalizeSearchToken('Air Peace!'), 'airpeace');
      assert.strictEqual(normalizeSearchToken('  P4-7120  '), 'p47120');
      assert.strictEqual(normalizeSearchToken('Ibom Air / QI-504'), 'ibomairqi504');
      assert.strictEqual(normalizeSearchToken(''), '');
      assert.strictEqual(normalizeSearchToken(null), '');
    });

    test('matches empty query to anything', () => {
      assert.strictEqual(matchesFlightSearch('', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('   ', 'P4 7120', 'Air Peace'), true);
    });

    test('matches search by airline name', () => {
      assert.strictEqual(matchesFlightSearch('peace', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('airpeace', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('united nigeria', 'UN 520', 'United Nigeria Airlines'), true);
      assert.strictEqual(matchesFlightSearch('green', 'Q9 302', 'Green Africa'), true);
      assert.strictEqual(matchesFlightSearch('delta', 'P4 7120', 'Air Peace'), false);
    });

    test('matches search by flight code with or without spaces and hyphens', () => {
      assert.strictEqual(matchesFlightSearch('p47120', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('P4-7120', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('7120', 'P4 7120', 'Air Peace'), true);
      assert.strictEqual(matchesFlightSearch('9999', 'P4 7120', 'Air Peace'), false);
    });
  });

  describe('fmtFlightTime & fmtFlightDateTime', () => {
    test('handles null, undefined and invalid timestamps gracefully', () => {
      assert.strictEqual(fmtFlightTime(null), '—');
      assert.strictEqual(fmtFlightTime(undefined), '—');
      assert.strictEqual(fmtFlightTime('not-a-date'), '—');
      assert.strictEqual(fmtFlightDateTime(null), '—');
      assert.strictEqual(fmtFlightDateTime(undefined), '—');
      assert.strictEqual(fmtFlightDateTime('invalid'), '—');
    });

    test('formats valid ISO time in Africa/Lagos (UTC+1)', () => {
      // 2026-11-18T10:30:00Z -> Lagos is 11:30
      const iso = '2026-11-18T10:30:00Z';
      const formatted = fmtFlightTime(iso);
      assert.strictEqual(formatted, '11:30');
    });

    test('formats valid ISO date & time in Africa/Lagos', () => {
      const iso = '2026-11-18T10:30:00Z';
      const formatted = fmtFlightDateTime(iso);
      assert.match(formatted, /18 Nov/);
      assert.match(formatted, /11:30/);
    });
  });

  describe('formatDelayMinutes', () => {
    test('returns formatted string for positive numbers', () => {
      assert.strictEqual(formatDelayMinutes(45), '+45m');
      assert.strictEqual(formatDelayMinutes(15.2), '+15m');
      assert.strictEqual(formatDelayMinutes(120), '+120m');
    });

    test('returns empty string for zero, negative or non-numbers', () => {
      assert.strictEqual(formatDelayMinutes(0), '');
      assert.strictEqual(formatDelayMinutes(-10), '');
      assert.strictEqual(formatDelayMinutes(null), '');
      assert.strictEqual(formatDelayMinutes(undefined), '');
      assert.strictEqual(formatDelayMinutes(NaN), '');
    });
  });

  describe('getFlightStatusMeta', () => {
    test('returns correct calm presentation metadata for all flight statuses', () => {
      const landed = getFlightStatusMeta('landed');
      assert.strictEqual(landed.label, 'Landed');
      assert.strictEqual(landed.badgeTone, 'success');

      const returned = getFlightStatusMeta('returned');
      assert.strictEqual(returned.label, 'Returned to origin');
      assert.strictEqual(returned.badgeTone, 'error');

      const delayed = getFlightStatusMeta('delayed');
      assert.strictEqual(delayed.label, 'Delayed');
      assert.strictEqual(delayed.badgeTone, 'warning');

      const enroute = getFlightStatusMeta('departed');
      assert.strictEqual(enroute.label, 'En route');
      assert.strictEqual(enroute.badgeTone, 'info');

      const unknown = getFlightStatusMeta('unknown');
      assert.strictEqual(unknown.label, 'Not tracked');
      assert.strictEqual(unknown.badgeTone, 'neutral');
    });
  });

  describe('groupFlights & groupNationalFlights', () => {
    const mockFlights: BoardFlight[] = [
      {
        flightNumber: 'P4 7120',
        airline: 'Air Peace',
        route: 'LOS -> ABV',
        entries: [],
        status: {
          status: 'delayed',
          scheduled_departure: null,
          actual_departure: null,
          scheduled_arrival: null,
          actual_arrival: null,
          delay_minutes: 45,
          departure_airport: 'LOS',
          arrival_airport: 'ABV',
          diverted_airport: null,
        },
      },
      {
        flightNumber: 'AJ 131',
        airline: 'Aero Contractors',
        route: 'LOS -> KAN',
        entries: [],
        status: {
          status: 'diverted',
          scheduled_departure: null,
          actual_departure: null,
          scheduled_arrival: null,
          actual_arrival: null,
          delay_minutes: null,
          departure_airport: 'LOS',
          arrival_airport: 'KAN',
          diverted_airport: 'LOS',
        },
      },
      {
        flightNumber: 'QI 0504',
        airline: 'Ibom Air',
        route: 'LOS -> UYO',
        entries: [],
        status: {
          status: 'departed',
          scheduled_departure: null,
          actual_departure: null,
          scheduled_arrival: null,
          actual_arrival: null,
          delay_minutes: 0,
          departure_airport: 'LOS',
          arrival_airport: 'QUO',
          diverted_airport: null,
        },
      },
      {
        flightNumber: 'VK 201',
        airline: 'ValueJet',
        route: 'LOS -> BNI',
        entries: [],
        status: {
          status: 'scheduled',
          scheduled_departure: null,
          actual_departure: null,
          scheduled_arrival: null,
          actual_arrival: null,
          delay_minutes: null,
          departure_airport: 'LOS',
          arrival_airport: 'BNI',
          diverted_airport: null,
        },
      },
      {
        flightNumber: 'Q9 302',
        airline: 'Green Africa',
        route: 'LOS -> ILR',
        entries: [],
        status: {
          status: 'landed',
          scheduled_departure: null,
          actual_departure: null,
          scheduled_arrival: null,
          actual_arrival: null,
          delay_minutes: 0,
          departure_airport: 'LOS',
          arrival_airport: 'ILR',
          diverted_airport: null,
        },
      },
    ];

    test('partitions flights into attention, enroute, scheduled, and landed', () => {
      const groups = groupFlights(mockFlights);
      assert.strictEqual(groups.length, 4);

      const attention = groups.find(g => g.id === 'attention')!;
      const enroute = groups.find(g => g.id === 'enroute')!;
      const scheduled = groups.find(g => g.id === 'scheduled')!;
      const landed = groups.find(g => g.id === 'landed')!;

      // P4 7120 (delayed) and AJ 131 (diverted back -> returned) are in Attention
      assert.strictEqual(attention.items.length, 2);
      assert.ok(attention.items.some(f => f.flightNumber === 'P4 7120'));
      assert.ok(attention.items.some(f => f.flightNumber === 'AJ 131'));

      // QI 0504 (departed) is En route
      assert.strictEqual(enroute.items.length, 1);
      assert.strictEqual(enroute.items[0].flightNumber, 'QI 0504');

      // VK 201 is Scheduled
      assert.strictEqual(scheduled.items.length, 1);
      assert.strictEqual(scheduled.items[0].flightNumber, 'VK 201');

      // Q9 302 is Landed
      assert.strictEqual(landed.items.length, 1);
      assert.strictEqual(landed.items[0].flightNumber, 'Q9 302');
    });

    test('filters groups with search term', () => {
      const groups = groupFlights(mockFlights, 'ibom');
      const enroute = groups.find(g => g.id === 'enroute')!;
      const attention = groups.find(g => g.id === 'attention')!;

      assert.strictEqual(enroute.items.length, 1);
      assert.strictEqual(enroute.items[0].flightNumber, 'QI 0504');
      assert.strictEqual(attention.items.length, 0);
    });

    test('partitions national flights correctly', () => {
      const national: NationalFlight[] = [
        {
          flightNumber: 'P4 7120',
          airline: 'Air Peace',
          originIata: 'LOS',
          destinationIata: 'ABV',
          scheduledDeparture: null,
          status: 'delayed',
        },
        {
          flightNumber: 'QI 0504',
          airline: 'Ibom Air',
          originIata: 'LOS',
          destinationIata: 'QUO',
          scheduledDeparture: null,
          status: 'departed',
        },
      ];

      const groups = groupNationalFlights(national);
      const attention = groups.find(g => g.id === 'attention')!;
      const enroute = groups.find(g => g.id === 'enroute')!;

      assert.strictEqual(attention.items.length, 1);
      assert.strictEqual(enroute.items.length, 1);
    });
  });

  describe('timelineStepIndex & isStatusInterrupted', () => {
    test('returns correct timeline positions', () => {
      assert.strictEqual(timelineStepIndex('scheduled'), 0);
      assert.strictEqual(timelineStepIndex('cancelled'), 0);
      assert.strictEqual(timelineStepIndex('boarding'), 1);
      assert.strictEqual(timelineStepIndex('delayed'), 1);
      assert.strictEqual(timelineStepIndex('departed'), 2);
      assert.strictEqual(timelineStepIndex('diverted'), 2);
      assert.strictEqual(timelineStepIndex('returned'), 2);
      assert.strictEqual(timelineStepIndex('landed'), 3);
    });

    test('identifies interrupted attention statuses', () => {
      assert.strictEqual(isStatusInterrupted('delayed'), true);
      assert.strictEqual(isStatusInterrupted('cancelled'), true);
      assert.strictEqual(isStatusInterrupted('diverted'), true);
      assert.strictEqual(isStatusInterrupted('returned'), true);
      assert.strictEqual(isStatusInterrupted('departed'), false);
      assert.strictEqual(isStatusInterrupted('landed'), false);
    });
  });

  describe('formatRouteDisplay', () => {
    test('cleans route arrows and extra spaces', () => {
      assert.strictEqual(formatRouteDisplay('LOS -> ABV'), 'LOS → ABV');
      assert.strictEqual(formatRouteDisplay('LOS  ->   KAN'), 'LOS → KAN');
      assert.strictEqual(formatRouteDisplay('LOS → ABV'), 'LOS → ABV');
      assert.strictEqual(formatRouteDisplay('ABV -> ENU -> PHC'), 'ABV → ENU → PHC');
      assert.strictEqual(formatRouteDisplay('   LOS -> QUO   '), 'LOS → QUO');
      assert.strictEqual(formatRouteDisplay(''), '');
      assert.strictEqual(formatRouteDisplay(null), '');
      assert.strictEqual(formatRouteDisplay(undefined), '');
    });
  });

  describe('Extended Flight Radar Status & Badge Integrity', () => {
    test('every status label is clean sentence case without uppercase shouting', () => {
      const statuses = [
        'landed',
        'departed',
        'boarding',
        'delayed',
        'returned',
        'diverted',
        'cancelled',
        'scheduled',
        'unknown',
      ];
      for (const st of statuses) {
        const meta = getFlightStatusMeta(st);
        assert.ok(meta.label.length > 0);
        // Verify sentence case: First char uppercase, following letters not all uppercase
        assert.strictEqual(meta.label[0], meta.label[0].toUpperCase());
        assert.notStrictEqual(meta.label, meta.label.toUpperCase(), `Label "${meta.label}" should not be all uppercase`);
      }
    });

    test('effectiveStatus handles case insensitivity', () => {
      assert.strictEqual(effectiveStatus({ status: 'LANDED' } as any), 'landed');
      assert.strictEqual(effectiveStatus({ status: '  Boarding  ' } as any), 'boarding');
      assert.strictEqual(effectiveStatus({ status: 'DELAYED' } as any), 'delayed');
    });
  });

  describe('Role & Mode Permissions for Flight Radar', () => {
    const superAdmin: User = {
      id: 'super-1',
      email: 'boss@ehi.ng',
      name: 'Super Admin',
      role: 'super_admin',
      hub: 'Lagos Hub',
      hubType: 'Cargo Station',
      hub_id: 'hub-los',
    };

    const adminUser: User = {
      id: 'admin-1',
      email: 'admin@ehi.ng',
      name: 'Air Admin',
      role: 'admin',
      hub: 'Lagos Hub',
      hubType: 'Cargo Station',
      hub_id: 'hub-los',
    };

    const cargoAgent: User = {
      id: 'agent-1',
      email: 'agent@ehi.ng',
      name: 'Cargo Counter Agent',
      role: 'cargo_agent',
      hub: 'Lagos Hub',
      hubType: 'Cargo Station',
      hub_id: 'hub-los',
    };

    const driverUser: User = {
      id: 'driver-1',
      email: 'driver@ehi.ng',
      name: 'Dispatch Driver',
      role: 'driver',
      hub: 'Lagos Hub',
      hubType: 'Field Office',
      hub_id: 'hub-los',
    };

    test('canAccessTab permits FlightRadar in air and intermodal modes', () => {
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'air'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(adminUser, 'FlightRadar', [], 'air'), true);
      assert.strictEqual(canAccessTab(adminUser, 'FlightRadar', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(cargoAgent, 'FlightRadar', [], 'air'), true);
      assert.strictEqual(canAccessTab(cargoAgent, 'FlightRadar', [], 'intermodal'), true);
    });

    test('canAccessTab forbids FlightRadar in road mode across roles', () => {
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'road'), false);
      assert.strictEqual(canAccessTab(adminUser, 'FlightRadar', [], 'road'), false);
      assert.strictEqual(canAccessTab(cargoAgent, 'FlightRadar', [], 'road'), false);
      assert.strictEqual(canAccessTab(driverUser, 'FlightRadar', [], 'road'), false);
    });

    test('driver role can access Flight Radar in air and intermodal modes', () => {
      assert.strictEqual(canAccessTab(driverUser, 'FlightRadar', [], 'air'), true);
      assert.strictEqual(canAccessTab(driverUser, 'FlightRadar', [], 'intermodal'), true);
    });
  });
});
