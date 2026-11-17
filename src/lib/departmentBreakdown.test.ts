import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDepartmentRows,
  buildDepartmentRowsFromTransactions,
  RawDepartmentStream,
} from './departmentBreakdown';

describe('Department Breakdown Legacy Stream Rules', () => {
  describe('buildDepartmentRows', () => {
    test('zero-count legacy streams are omitted entirely from rows', () => {
      const streams: RawDepartmentStream[] = [
        { key: 'cargo', name: 'Cargo Station', amount: 150000, count: 12 },
        { key: 'package', name: 'Package Desk', amount: 45000, count: 5 },
        { key: 'baggage', amount: 0, count: 0 },
        { key: 'marketing', amount: 0, count: 0 },
      ];

      const { rows, grandTotal } = buildDepartmentRows(streams);

      const keys = rows.map(r => r.key);
      assert.ok(!keys.includes('baggage'), 'Excess Baggage with count 0 must be omitted');
      assert.ok(!keys.includes('marketing'), 'Marketing with count 0 must be omitted');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].name, 'Cargo Station');
      assert.strictEqual(rows[1].name, 'Package Desk');
      assert.strictEqual(grandTotal, 195000);
    });

    test('non-zero legacy streams are kept with the (legacy) label', () => {
      const streams: RawDepartmentStream[] = [
        { key: 'cargo', name: 'Cargo Station', amount: 100000, count: 8 },
        { key: 'package', name: 'Package Desk', amount: 20000, count: 2 },
        { key: 'baggage', name: 'Excess Baggage', amount: 35000, count: 3 },
        { key: 'marketing', name: 'Field Marketing', amount: 50000, count: 4 },
      ];

      const { rows, grandTotal } = buildDepartmentRows(streams);

      assert.strictEqual(rows.length, 4);

      const baggageRow = rows.find(r => r.key === 'baggage');
      assert.ok(baggageRow, 'Non-zero baggage stream must be kept');
      assert.strictEqual(baggageRow.name, 'Excess Baggage (legacy)');
      assert.strictEqual(baggageRow.amount, 35000);
      assert.strictEqual(baggageRow.count, 3);
      assert.strictEqual(baggageRow.isLegacy, true);

      const mktgRow = rows.find(r => r.key === 'marketing');
      assert.ok(mktgRow, 'Non-zero marketing stream must be kept');
      assert.strictEqual(mktgRow.name, 'Marketing (legacy)');
      assert.strictEqual(mktgRow.amount, 50000);
      assert.strictEqual(mktgRow.count, 4);
      assert.strictEqual(mktgRow.isLegacy, true);

      assert.strictEqual(grandTotal, 205000);
    });

    test('grand total unchanged whether legacy streams are omitted or present', () => {
      // Scenario A: baggage has count 0 but legacy amount 500 (e.g. edge adjustment)
      const streamsWithZeroCountButAmount: RawDepartmentStream[] = [
        { key: 'cargo', amount: 100000, count: 5 },
        { key: 'package', amount: 50000, count: 2 },
        { key: 'baggage', amount: 15000, count: 0 },
        { key: 'marketing', amount: 0, count: 0 },
      ];

      const resultA = buildDepartmentRows(streamsWithZeroCountButAmount);
      // Zero-count baggage omitted from list
      assert.strictEqual(resultA.rows.length, 2);
      // But grandTotal still includes the 15000 legacy amount!
      assert.strictEqual(resultA.grandTotal, 165000);

      // Scenario B: both active, one legacy present, one zero
      const streamsMixed: RawDepartmentStream[] = [
        { key: 'cargo', amount: 80000, count: 4 },
        { key: 'package', amount: 20000, count: 1 },
        { key: 'baggage', amount: 0, count: 0 },
        { key: 'marketing', amount: 12000, count: 1 },
      ];

      const resultB = buildDepartmentRows(streamsMixed);
      assert.strictEqual(resultB.rows.length, 3);
      assert.ok(resultB.rows.some(r => r.name === 'Marketing (legacy)'));
      assert.ok(!resultB.rows.some(r => r.key === 'baggage'));
      assert.strictEqual(resultB.grandTotal, 112000);
    });

    test('options allow custom cargo and package labels', () => {
      const streams: RawDepartmentStream[] = [
        { key: 'cargo', amount: 50000, count: 2 },
        { key: 'package', amount: 10000, count: 1 },
      ];

      const { rows } = buildDepartmentRows(streams, {
        cargoLabel: 'Cargo Station',
        packageLabel: 'Package Counter',
      });

      assert.strictEqual(rows[0].name, 'Cargo Station');
      assert.strictEqual(rows[1].name, 'Package Counter');
    });
  });

  describe('buildDepartmentRowsFromTransactions', () => {
    test('filters out zero-count legacy transactions while aggregating correctly', () => {
      const txs = [
        { type: 'cargo', amount: 10000 },
        { type: 'cargo', amount: 15000 },
        { type: 'package', amount: 5000 },
        { type: 'cargo', amount: 2000, is_debt_clearance: true }, // should be skipped from sales count/revenue
      ];

      const { rows, grandTotal } = buildDepartmentRowsFromTransactions(txs, {
        cargoLabel: 'Cargo Station',
      });

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].name, 'Cargo Station');
      assert.strictEqual(rows[0].amount, 25000);
      assert.strictEqual(rows[0].count, 2);

      assert.strictEqual(rows[1].name, 'Package Desk');
      assert.strictEqual(rows[1].amount, 5000);
      assert.strictEqual(rows[1].count, 1);

      assert.strictEqual(grandTotal, 30000);
    });

    test('includes legacy transactions with (legacy) labels when present in period', () => {
      const txs = [
        { type: 'cargo', amount: 30000 },
        { type: 'package', amount: 10000 },
        { type: 'baggage', amount: 8000 },
        { type: 'marketing', amount: 12000 },
      ];

      const { rows, grandTotal } = buildDepartmentRowsFromTransactions(txs);

      assert.strictEqual(rows.length, 4);

      const baggage = rows.find(r => r.key === 'baggage');
      assert.ok(baggage);
      assert.strictEqual(baggage.name, 'Excess Baggage (legacy)');
      assert.strictEqual(baggage.amount, 8000);
      assert.strictEqual(baggage.count, 1);

      const marketing = rows.find(r => r.key === 'marketing');
      assert.ok(marketing);
      assert.strictEqual(marketing.name, 'Marketing (legacy)');
      assert.strictEqual(marketing.amount, 12000);
      assert.strictEqual(marketing.count, 1);

      assert.strictEqual(grandTotal, 60000);
    });
  });
});
