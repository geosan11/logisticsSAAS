import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { EHILogoPDF } from '../EHILogoPDF';

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 20 },
  title: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 20 },
  tableTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 15, marginBottom: 5 },

  table: { display: 'flex', width: 'auto', borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0, borderColor: '#e5e7eb' },
  tableRow: { flexDirection: 'row' },
  tableColHeader: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableColHeaderNarrow: { width: '12%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 5 },
  tableCol: { flex: 1, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColWide: { flex: 2, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableColNarrow: { width: '12%', borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0, borderColor: '#e5e7eb', padding: 5 },
  tableCellHeader: { fontSize: 8, fontWeight: 'bold' },
  tableCell: { fontSize: 8 },

  summaryBox: { marginTop: 20, padding: 15, backgroundColor: '#f9fafb', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  footer: { marginTop: 30, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

const PDFHeader = ({ title, hubName, generatedBy, generatedAt }: { title: string; hubName: string; generatedBy: string; generatedAt: string }) => (
  <View style={styles.header}>
    <View style={{ alignItems: 'center', marginBottom: 15 }}>
      <EHILogoPDF width={120} />
    </View>
    <Text style={styles.title}>{title}</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
      <Text style={{ fontSize: 9 }}>Hub: {hubName}</Text>
      <Text style={{ fontSize: 9 }}>Generated: {generatedAt} by {generatedBy}</Text>
    </View>
  </View>
);

// ── DEBTS (Receivables) ──────────────────────────────────────

export interface DebtsLedgerPDFData {
  hubName: string;
  generatedBy: string;
  generatedAt: string;
  debtSummary: Array<{ name: string; amount: number }>;
  debts: Array<{ name: string; detail: string; balance: number; id: string; time: string }>;
  totalDebt: number;
}

const DebtsLedgerPDF = ({ data }: { data: DebtsLedgerPDFData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <PDFHeader title="RECEIVABLES — OUTSTANDING DEBTS" hubName={data.hubName} generatedBy={data.generatedBy} generatedAt={data.generatedAt} />

      <View style={styles.summaryBox}>
        <Text style={{ fontSize: 10, fontWeight: 'bold' }}>TOTAL OUTSTANDING DEBT: NGN {data.totalDebt.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
      </View>

      <Text style={styles.tableTitle}>DEBTORS BREAKDOWN</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>NAME</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>AMOUNT (NGN)</Text></View>
        </View>
        {data.debtSummary.map((d, i) => (
          <View style={styles.tableRow} key={i}>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{d.name}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{d.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <Text style={styles.tableTitle}>DETAILED LEDGER ({data.debts.length})</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>REF</Text></View>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>NAME</Text></View>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>DETAIL</Text></View>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>DATE</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>BALANCE (NGN)</Text></View>
        </View>
        {data.debts.map((t, i) => (
          <View style={styles.tableRow} key={i}>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{t.id}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{t.name}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{t.detail}</Text></View>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{new Date(t.time).toLocaleDateString()}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{t.balance.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>Powered by Haulwey</Text>
    </Page>
  </Document>
);

export const downloadDebtsLedgerPDF = async (data: DebtsLedgerPDFData) => {
  const blob = await pdf(<DebtsLedgerPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receivables_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── CREDITS (Payables to airlines) ───────────────────────────

export interface CreditsLedgerPDFData {
  hubName: string;
  generatedBy: string;
  generatedAt: string;
  creditSummary: Array<{ airline: string; amount: number }>;
  credits: Array<{ airline: string; id: string; baseAmount: number; commRate: number; commissionAmount: number; weOwe: number; detail: string }>;
  totalCredit: number;
}

const CreditsLedgerPDF = ({ data }: { data: CreditsLedgerPDFData }) => (
  <Document>
    <Page size="A4" orientation="landscape" style={styles.page}>
      <PDFHeader title="PAYABLES — DUE TO AIRLINES" hubName={data.hubName} generatedBy={data.generatedBy} generatedAt={data.generatedAt} />

      <View style={styles.summaryBox}>
        <Text style={{ fontSize: 10, fontWeight: 'bold' }}>TOTAL DUE TO AIRLINES: NGN {data.totalCredit.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
      </View>

      <Text style={styles.tableTitle}>AIRLINES BREAKDOWN</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>AIRLINE</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>AMOUNT (NGN)</Text></View>
        </View>
        {data.creditSummary.map((c, i) => (
          <View style={styles.tableRow} key={i}>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{c.airline}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{c.amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <Text style={styles.tableTitle}>DETAILED REMITTANCES ({data.credits.length})</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>REF</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>AIRLINE</Text></View>
          <View style={styles.tableColHeaderWide}><Text style={styles.tableCellHeader}>DETAIL</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>BASE (NGN)</Text></View>
          <View style={styles.tableColHeaderNarrow}><Text style={styles.tableCellHeader}>COMM %</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>COMMISSION (NGN)</Text></View>
          <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>WE OWE (NGN)</Text></View>
        </View>
        {data.credits.map((c, i) => (
          <View style={styles.tableRow} key={i}>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{c.id}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{c.airline}</Text></View>
            <View style={styles.tableColWide}><Text style={styles.tableCell}>{c.detail}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{c.baseAmount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
            <View style={styles.tableColNarrow}><Text style={styles.tableCell}>{c.commRate}%</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{c.commissionAmount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
            <View style={styles.tableCol}><Text style={styles.tableCell}>{c.weOwe.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text></View>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>Powered by Haulwey</Text>
    </Page>
  </Document>
);

export const downloadCreditsLedgerPDF = async (data: CreditsLedgerPDFData) => {
  const blob = await pdf(<CreditsLedgerPDF data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Payables_${new Date().toISOString().split('T')[0]}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
