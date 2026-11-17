import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { EHILogoPDF } from '../EHILogoPDF';
import { AirlineLogoPDF } from '../AirlineLogoPDF';
import { resolveAirlineLogoUrl } from '../../lib/airlineLogos';

export interface AirlineLedgerPDFRow {
  entry_date: string;
  reference: string | null;
  description: string;
  entry_type: 'Credit' | 'Debit' | 'Cheque Raise';
  amount: number;
  runningBalance: number;
}

export interface AirlineLedgerPDFData {
  airlineName: string;
  hubName: string;
  generatedBy: string;
  generatedAt: string;
  rows: AirlineLedgerPDFRow[];
  summary: { credits: number; debits: number; cheques: number; net: number };
  airlineLogoUrl?: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 20 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },

  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb', marginTop: 10 },
  tableRow: { flexDirection: 'row' },
  tableColHeader: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderNarrow: { width: '10%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },

  tableCol: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColNarrow: { width: '10%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },

  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },

  summaryBox: { marginTop: 20, padding: 15, backgroundColor: '#f9fafb', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 9, color: '#4b5563' },
  summaryValue: { fontSize: 10, fontWeight: 'bold' },

  footer: { marginTop: 30, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

const AirlineLedgerPDFDoc = ({ data }: { data: AirlineLedgerPDFData }) => (
  <Document>
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 }}>
          <EHILogoPDF width={110} />
          <AirlineLogoPDF airline={data.airlineName} logoUrl={data.airlineLogoUrl} width={90} />
        </View>
        <Text style={styles.title}>{data.airlineName.toUpperCase()} — BALANCE LEDGER</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 9 }}>Hub: {data.hubName}</Text>
          <Text style={{ fontSize: 9 }}>Generated: {data.generatedAt} by {data.generatedBy}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>DATE</Text></View>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>REFERENCE</Text></View>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>DESCRIPTION</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>CREDIT (NGN)</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>DEBIT (NGN)</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>CHEQUE RAISE (NGN)</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>BALANCE (NGN)</Text></View>
        </View>
        {data.rows.map((r, i) => (
          <View style={styles.tableRow} key={i}>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{r.entry_date}</Text></View>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{r.reference || '-'}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{r.description}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{r.entry_type === 'Credit' ? r.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : '—'}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{r.entry_type === 'Debit' ? r.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : '—'}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{r.entry_type === 'Cheque Raise' ? r.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : '—'}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{r.runningBalance < 0 ? '-' : ''}{Math.abs(r.runningBalance).toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <View style={styles.summaryBox}>
        <View><Text style={styles.summaryLabel}>Total Credits</Text><Text style={styles.summaryValue}>NGN {data.summary.credits.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View><Text style={styles.summaryLabel}>Total Debits</Text><Text style={styles.summaryValue}>NGN {data.summary.debits.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View><Text style={styles.summaryLabel}>Total Cheques Raised</Text><Text style={styles.summaryValue}>NGN {data.summary.cheques.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
        <View><Text style={styles.summaryLabel}>Net Balance</Text><Text style={styles.summaryValue}>NGN {data.summary.net.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
      </View>

      <Text style={styles.footer}>Powered by Haulwey</Text>
    </Page>
  </Document>
);

export const downloadAirlineLedgerPDF = async (data: AirlineLedgerPDFData) => {
  const withLogo: AirlineLedgerPDFData = data.airlineLogoUrl !== undefined
    ? data
    : { ...data, airlineLogoUrl: await resolveAirlineLogoUrl(data.airlineName) };

  const blob = await pdf(<AirlineLedgerPDFDoc data={withLogo} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.airlineName.replace(/\s+/g, '_')}_Ledger_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
