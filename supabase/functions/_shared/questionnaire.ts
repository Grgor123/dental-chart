// The health questionnaire (vprašalnik o zdravju) — every question, in
// Slovene and English. Pure data, NO Deno APIs and no imports, because it's
// shared three ways, same as email/templateDefs.ts:
//   - the public health-questionnaire Edge Function returns it as JSON, and
//     docs/health-questionnaire.html (GitHub Pages) renders the form from it;
//   - the same function validates a submission against it;
//   - the Patient Record page (src/components/questionnaire/) imports it
//     directly to show the answers and build the red alert banner.
// One source of truth, so the patient form and what staff see can't drift.
//
// Content follows the practice's own paper form (based on the Medical
// Chamber of Slovenia's questionnaire, per FDI's 1989 recommendation).
// Bump FORM_VERSION when questions change in a way that changes meaning —
// every submission stores the version it was answered against.

export const FORM_VERSION = 1;

export type QuestionnaireLanguage = 'sl' | 'en';
export type Localized = Record<QuestionnaireLanguage, string>;

export interface YesNoQuestion {
  kind: 'yesno';
  id: string;
  text: Localized;
  /** Optional free-text follow-up, shown once "yes" is picked. */
  detail?: Localized;
  /** Short staff-facing label for the alert banner when answered "yes". */
  alertLabel: string;
  /** Only shown to patients recorded as female (or with no sex recorded). */
  womenOnly?: boolean;
}

export interface TextQuestion {
  kind: 'text';
  id: string;
  text: Localized;
}

/** A list of medicines, each marked "redno" (regularly) or "pogosto" (often). */
export interface MedicationsQuestion {
  kind: 'medications';
  id: string;
  text: Localized;
}

export interface ConditionsQuestion {
  kind: 'conditions';
  id: string;
  text: Localized;
}

export type Question = YesNoQuestion | TextQuestion | MedicationsQuestion | ConditionsQuestion;

export const QUESTIONS: readonly Question[] = [
  {
    kind: 'yesno',
    id: 'illness',
    text: { sl: 'Ali bolehate za katero boleznijo?', en: 'Do you suffer from any illness?' },
    detail: { sl: 'Za katero?', en: 'Which one?' },
    alertLabel: 'Bolezen',
  },
  {
    kind: 'yesno',
    id: 'doctor_2y',
    text: {
      sl: 'Ali ste se v zadnjih dveh letih zdravili pri zdravniku?',
      en: 'Have you been treated by a doctor in the last two years?',
    },
    detail: { sl: 'Zaradi katere bolezni ali stanja?', en: 'For which illness or condition?' },
    alertLabel: 'Zdravljenje pri zdravniku (zadnji 2 leti)',
  },
  {
    kind: 'yesno',
    id: 'hospital_2y',
    text: {
      sl: 'Ali ste se v zadnjih dveh letih zdravili v bolnišnici?',
      en: 'Have you been treated in a hospital in the last two years?',
    },
    alertLabel: 'Bolnišnično zdravljenje (zadnji 2 leti)',
  },
  {
    kind: 'medications',
    id: 'medications',
    text: {
      sl: 'Katera zdravila jemljete redno in katera pogosto?',
      en: 'Which medications do you use regularly and which are taken often?',
    },
  },
  {
    kind: 'yesno',
    id: 'anesthesia',
    text: {
      sl: 'Ali ste vi ali kdo v vaši družini imeli komplikacije, ko ste dobili lokalno ali splošno anestezijo?',
      en: 'Have you or anyone in your family had complications when given local or general anesthesia?',
    },
    alertLabel: 'Zapleti pri anesteziji',
  },
  {
    kind: 'yesno',
    id: 'allergies',
    text: { sl: 'Ali ste alergični na kakšno zdravilo ali kakšno snov?', en: 'Are you allergic to any medication or substance?' },
    detail: { sl: 'Na katero zdravilo ali snov?', en: 'To which medication or substance?' },
    // Shown in the banner's own "Alergije" column, not among the conditions.
    alertLabel: 'Alergija',
  },
  {
    kind: 'yesno',
    id: 'bleeding',
    text: { sl: 'Ali so pri vas kdaj nastopile motnje v strjevanju krvi?', en: 'Have you ever had a bleeding disorder?' },
    alertLabel: 'Motnje strjevanja krvi',
  },
  {
    kind: 'yesno',
    id: 'irradiation',
    text: {
      sl: 'Ali so vas kdaj zdravili z obsevanjem glave ali vratu?',
      en: 'Have you ever been treated with head or neck irradiation?',
    },
    alertLabel: 'Obsevanje glave ali vratu',
  },
  {
    kind: 'yesno',
    id: 'infectious',
    text: { sl: 'Ali imate kakšno infekcijsko bolezen?', en: 'Do you have any infectious disease?' },
    alertLabel: 'Nalezljiva bolezen',
  },
  {
    kind: 'yesno',
    id: 'transfusion',
    text: { sl: 'Ali ste kdaj dobili transfuzijo krvi?', en: 'Have you ever received a blood transfusion?' },
    detail: { sl: 'Navedite tip in datum.', en: 'List type and date.' },
    alertLabel: 'Transfuzija krvi',
  },
  {
    kind: 'yesno',
    id: 'hiv',
    text: {
      sl: 'Ali bi lahko bili izpostavljeni virusu AIDS (HIV)?',
      en: 'Could you have been exposed to the AIDS (HIV) virus?',
    },
    alertLabel: 'Možna izpostavljenost HIV',
  },
  {
    kind: 'yesno',
    id: 'pregnant',
    text: { sl: 'Za ženske: ali ste noseči?', en: 'For women: are you pregnant?' },
    detail: { sl: 'Kdaj pričakujete porod?', en: 'When do you expect to give birth?' },
    alertLabel: 'Nosečnost',
    womenOnly: true,
  },
  {
    kind: 'conditions',
    id: 'conditions',
    text: {
      // The paper form says "Obkrožite" (circle); online they're ticked.
      sl: 'Označite bolezni ali stanja, ki ste jih imeli ali jih imate:',
      en: 'Mark the diseases or conditions you have had or currently have:',
    },
  },
  {
    kind: 'text',
    id: 'other',
    text: {
      sl: 'Prosimo, napišite bolezen ali pomembno okoliščino, ki jo imate in ni vpisana na vprašalniku:',
      en: 'Please write down any illness or significant circumstance that you have and is not listed on the questionnaire:',
    },
  },
];

export interface Condition {
  id: string;
  label: Localized;
}

export const CONDITIONS: readonly Condition[] = [
  { id: 'heart_valve_defects', label: { sl: 'Okvara srčnih zaklopk', en: 'Heart valve defects' } },
  { id: 'artificial_heart_valve', label: { sl: 'Umetna srčna zaklopka', en: 'Artificial heart valve' } },
  { id: 'pulmonary_shunt', label: { sl: 'Pljučni shunt', en: 'Pulmonary shunt' } },
  { id: 'leukemia', label: { sl: 'Levkemija', en: 'Leukemia' } },
  { id: 'congenital_heart', label: { sl: 'Prirojene srčne okvare', en: 'Congenital heart dysfunction' } },
  { id: 'pacemaker', label: { sl: 'Srčni pacemaker', en: 'Heart pacemaker' } },
  { id: 'endocarditis', label: { sl: 'Endokarditis', en: 'Endocarditis' } },
  { id: 'anemia', label: { sl: 'Anemija', en: 'Anemia' } },
  { id: 'bronchiectasis', label: { sl: 'Bronhiektazije', en: 'Bronchiectasis' } },
  { id: 'psychiatric', label: { sl: 'Psihiatrično zdravljenje', en: 'Psychiatric treatment' } },
  { id: 'allergic', label: { sl: 'Alergične težave', en: 'Allergic problems' } },
  { id: 'liver', label: { sl: 'Zlatenica', en: 'Jaundice / liver disorder' } },
  { id: 'thyroid', label: { sl: 'Bolezni ščitnice', en: 'Thyroid diseases' } },
  { id: 'epilepsy', label: { sl: 'Epilepsija (božjast)', en: 'Epilepsy' } },
  { id: 'chronic_cough', label: { sl: 'Stalen kašelj', en: 'Chronic cough' } },
  { id: 'glaucoma', label: { sl: 'Glavkom', en: 'Glaucoma' } },
  { id: 'diabetes', label: { sl: 'Diabetes (sladkorna bolezen)', en: 'Diabetes' } },
  { id: 'lymph_nodes', label: { sl: 'Povečane bezgavke', en: 'Enlarged lymph nodes' } },
  { id: 'hepatitis', label: { sl: 'Virusni hepatitis', en: 'Viral hepatitis' } },
  { id: 'oral_candidiasis', label: { sl: 'Ustna kandidiaza', en: 'Oral candidiasis' } },
  { id: 'sinusitis', label: { sl: 'Sinusitis', en: 'Sinusitis' } },
  { id: 'gi_ulcer', label: { sl: 'Gastrointestinalni ulkus', en: 'Gastrointestinal ulcer' } },
  { id: 'tuberculosis', label: { sl: 'TBC', en: 'Tuberculosis' } },
  { id: 'sexual_disease', label: { sl: 'Spolna bolezen', en: 'Sexual disease' } },
  { id: 'malignancy', label: { sl: 'Malignom (rak)', en: 'Malignancy (cancer)' } },
  { id: 'high_blood_pressure', label: { sl: 'Visok krvni pritisk', en: 'High blood pressure' } },
  { id: 'asthma', label: { sl: 'Astma', en: 'Asthma' } },
  { id: 'arthritis', label: { sl: 'Artritis', en: 'Arthritis' } },
];

/** Fixed page text around the questions. */
export const FORM_TEXT = {
  title: { sl: 'Vprašalnik o zdravju', en: 'Health questionnaire' },
  intro: {
    sl: 'Vljudno vas naprošamo, da izpolnite vprašalnik, s katerim bomo dobili vpogled v vaše zdravstveno stanje in tako lahko primerno poskrbeli za vas. Podatki so zaupne narave in jih bo zobozdravnik uporabljal izključno za medicinske namene.',
    en: 'We kindly ask you to fill out the questionnaire, which will give us insight into your health status and thus enable us to properly take care of you. The data is confidential and will be used by the dentist exclusively for medical purposes.',
  },
  contactHeading: { sl: 'Vaši podatki', en: 'Your details' },
  contactHint: {
    sl: 'Podatke smo izpolnili iz naše evidence. Če kaj ni pravilno, jih popravite.',
    en: 'We filled these in from our records. Please correct anything that is wrong.',
  },
  changeNotice: {
    sl: 'Ob spremembi zdravstvenega stanja vas vljudno naprošamo, da nas o tem obvestite.',
    en: 'If there is a change in your health condition, we kindly ask you to inform us.',
  },
  signatureLabel: { sl: 'Podpis (vpišite ime in priimek)', en: 'Signature (type your full name)' },
  confirmLabel: {
    sl: 'Potrjujem, da so navedeni podatki resnični in popolni.',
    en: 'I confirm that the information provided is true and complete.',
  },
  medicationName: { sl: 'Ime zdravila', en: 'Medicine name' },
  marketingHeading: { sl: 'Obveščanje (neobvezno)', en: 'Updates (optional)' },
  // Placeholder wording, accepted as-is for now — to be confirmed with
  // whoever handles the practice's ZVOP-3/GDPR obligations. The exact text
  // shown is stored with every consent, so changing it later is safe.
  marketingText: {
    sl: 'Želim prejemati obvestila o novostih, akcijah in preventivnih pregledih zobozdravstva Goslar po e-pošti in SMS-ih. Soglasje lahko kadarkoli prekličem.',
    en: 'I would like to receive news, offers and preventive check-up reminders from Zobozdravstvo Goslar by email and SMS. I can withdraw this consent at any time.',
  },
  marketingHint: {
    sl: 'Ni pogoj za zdravljenje ali oddajo vprašalnika.',
    en: 'This is not required for treatment or for submitting the questionnaire.',
  },
  footnotes: {
    sl: [
      'Svetovno zobozdravniško združenje / World Dental Federation (FDI) je že leta 1989 izdalo priporočilo, da v okviru anamneze pacient izpolni vprašalnik o podatkih, ki so pomembni za nadaljnjo obravnavo. Na osnovi priporočil je Zdravniška zbornica Slovenije pripravila vsebino vprašalnika.',
      'Zakon o zbirkah podatkov s področja zdravstvenega varstva dovoljuje zbiranje teh podatkov (ZZPZ, Ur. list št. 65/2000).',
    ],
    en: [
      "The World Dental Federation (FDI) already in 1989 issued a recommendation that, as part of the patient's history, the patient should complete a questionnaire with information that is important for further treatment. Based on these recommendations, the Medical Chamber of Slovenia prepared the content of the questionnaire.",
      'The Act on Data Collections in the Field of Health Care allows the collection of this data (ZZPZ, Official Gazette No. 65/2000).',
    ],
  },
} as const;

export type MedicationFrequency = 'regular' | 'often';
export const MEDICATION_FREQUENCIES: readonly { id: MedicationFrequency; label: Localized }[] = [
  { id: 'regular', label: { sl: 'redno', en: 'regularly' } },
  { id: 'often', label: { sl: 'pogosto', en: 'often' } },
];

/** Labels for the prefilled contact fields. */
export const CONTACT_FIELDS = [
  { key: 'firstName', label: { sl: 'Ime', en: 'First name' } },
  { key: 'lastName', label: { sl: 'Priimek', en: 'Last name' } },
  { key: 'dob', label: { sl: 'Datum rojstva', en: 'Date of birth' } },
  { key: 'address', label: { sl: 'Naslov (ulica in hišna številka)', en: 'Address (street and number)' } },
  { key: 'postalCode', label: { sl: 'Poštna številka', en: 'Postal code' } },
  { key: 'city', label: { sl: 'Kraj', en: 'City' } },
  { key: 'phone', label: { sl: 'Telefon', en: 'Mobile phone' } },
  { key: 'email', label: { sl: 'Mail za sporočanje', en: 'Your email address for communication' } },
] as const;

export type ContactKey = (typeof CONTACT_FIELDS)[number]['key'];
export type ContactData = Record<ContactKey, string>;

/** What a submission stores in health_questionnaires.answers. */
export interface QuestionnaireAnswers {
  /** yesno question id -> answer. */
  yesNo: Record<string, 'yes' | 'no'>;
  /** yesno question id -> its follow-up text (only kept for "yes"). */
  details: Record<string, string>;
  /** text question id -> answer. */
  texts: Record<string, string>;
  /** Question 4: each medicine and how often it's taken. */
  medications: { name: string; frequency: MedicationFrequency }[];
  /** Ticked condition ids. */
  conditions: string[];
}

export function visibleQuestions(sex: 'M' | 'F' | null): Question[] {
  return QUESTIONS.filter((q) => !(q.kind === 'yesno' && q.womenOnly && sex === 'M'));
}

/** Validates and normalizes a raw submission. Returns an error code or clean answers. */
export function validateAnswers(
  raw: unknown,
  sex: 'M' | 'F' | null
): { answers: QuestionnaireAnswers } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_answers' };
  const input = raw as Partial<Record<keyof QuestionnaireAnswers, unknown>>;
  const yesNoIn = (input.yesNo ?? {}) as Record<string, unknown>;
  const detailsIn = (input.details ?? {}) as Record<string, unknown>;
  const textsIn = (input.texts ?? {}) as Record<string, unknown>;
  const conditionsIn = Array.isArray(input.conditions) ? input.conditions : [];

  const answers: QuestionnaireAnswers = { yesNo: {}, details: {}, texts: {}, medications: [], conditions: [] };
  const clip = (value: unknown, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

  for (const q of visibleQuestions(sex)) {
    if (q.kind === 'yesno') {
      const value = yesNoIn[q.id];
      if (value !== 'yes' && value !== 'no') return { error: `missing_${q.id}` };
      answers.yesNo[q.id] = value;
      if (value === 'yes' && q.detail) {
        // A "yes" with a follow-up question must have it filled in.
        const detail = clip(detailsIn[q.id]);
        if (!detail) return { error: `missing_detail_${q.id}` };
        answers.details[q.id] = detail;
      }
    } else if (q.kind === 'text') {
      const text = clip(textsIn[q.id]);
      if (text) answers.texts[q.id] = text;
    }
  }
  const medicationsIn = Array.isArray(input.medications) ? input.medications : [];
  for (const m of medicationsIn.slice(0, 50)) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const name = clip(row.name, 200);
    if (!name) continue;
    answers.medications.push({ name, frequency: row.frequency === 'often' ? 'often' : 'regular' });
  }
  const knownConditions = new Set(CONDITIONS.map((c) => c.id));
  answers.conditions = [...new Set(conditionsIn.filter((c): c is string => typeof c === 'string' && knownConditions.has(c)))];
  return { answers };
}

export interface QuestionnaireAlerts {
  /** Null = answered NE. */
  allergies: string | null;
  /** "Lisinopril (redno), …" — null when none listed. */
  medications: string | null;
  /** "Yes" answers (with their detail) plus ticked conditions, staff-facing Slovene. */
  conditions: string[];
}

export function frequencyLabel(frequency: MedicationFrequency): string {
  return MEDICATION_FREQUENCIES.find((f) => f.id === frequency)?.label.sl ?? frequency;
}

/** What the red banner on the Patient Record page shows. */
export function summarizeAlerts(answers: QuestionnaireAnswers): QuestionnaireAlerts {
  const conditions: string[] = [];
  for (const q of QUESTIONS) {
    if (q.kind !== 'yesno' || q.id === 'allergies' || answers.yesNo[q.id] !== 'yes') continue;
    const detail = answers.details[q.id];
    conditions.push(detail ? `${q.alertLabel}: ${detail}` : q.alertLabel);
  }
  for (const c of CONDITIONS) {
    if (answers.conditions.includes(c.id)) conditions.push(c.label.sl);
  }
  const allergies = answers.yesNo.allergies === 'yes' ? (answers.details.allergies ?? 'DA (snov ni navedena)') : null;
  const medicationList = answers.medications ?? [];
  const medications =
    medicationList.length > 0 ? medicationList.map((m) => `${m.name} (${frequencyLabel(m.frequency)})`).join(', ') : null;
  return { allergies, medications, conditions };
}
