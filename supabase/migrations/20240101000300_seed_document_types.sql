-- =====================================================================
-- Sanad - global document type reference data (org_id = null)
--
-- The renewal_checklist is the part customers cannot get from a
-- spreadsheet. Keep it concrete: which counter, which portal, what to
-- bring. Vague advice is worse than none.
-- =====================================================================

insert into public.document_types
  (org_id, code, label, applies_to, default_lead_days, typical_lead_time_days, typical_cost_aed, renewal_checklist)
values
(null, 'trade_licence', 'Trade Licence', 'entity', '{90,60,30,7,0}', 21, 12000, $json$
{
  "steps": [
    {"title": "Check for outstanding fines", "detail": "Clear any labour, immigration or municipality fines first. Renewal is blocked while fines are open.", "where": "Relevant free zone portal or DED / economy department portal"},
    {"title": "Renew the Ejari tenancy contract", "detail": "The licence cannot be renewed against an expired tenancy. Ejari must have at least one month of validity remaining.", "where": "Ejari portal or the free zone leasing desk"},
    {"title": "Obtain the renewal quotation", "detail": "Request the payment voucher and confirm the activity list has not changed.", "where": "Licensing authority portal"},
    {"title": "Pay and collect", "detail": "Pay the voucher and download the new licence. Circulate the PDF to the bank and to any client who holds it on file.", "where": "Licensing authority portal"}
  ],
  "documents_required": ["Existing trade licence copy", "Valid Ejari or lease agreement", "Passport and Emirates ID of every partner", "Memorandum of Association if amended", "Payment voucher"]
}
$json$::jsonb),

(null, 'establishment_card', 'Establishment Card (Immigration Card)', 'entity', '{90,60,30,7,0}', 7, 2000, $json$
{
  "steps": [
    {"title": "Confirm the trade licence is valid", "detail": "The establishment card is issued against the licence and cannot outlast it. Renew the licence first if both are near expiry.", "where": "Immigration portal"},
    {"title": "Submit the renewal application", "detail": "Apply through a registered typing centre or the online channel using the establishment number.", "where": "GDRFA or ICP portal"},
    {"title": "Pay the fee and download the card", "detail": "The new card is issued electronically, usually within two to three working days.", "where": "GDRFA or ICP portal"}
  ],
  "documents_required": ["Valid trade licence", "Previous establishment card", "Passport copy of the manager or partner", "Signed application form"]
}
$json$::jsonb),

(null, 'employee_visa', 'Employee Residence Visa', 'employee', '{90,60,30,7,0}', 30, 5000, $json$
{
  "steps": [
    {"title": "Book the medical fitness test", "detail": "Required for every renewal. Results take two to five working days, longer if a retest is needed.", "where": "DHA, SEHA or approved medical fitness centre"},
    {"title": "Renew medical insurance", "detail": "Proof of an active policy meeting the minimum benefit level is required before the visa is stamped.", "where": "Insurance broker or provider"},
    {"title": "Apply for Emirates ID renewal", "detail": "Run the Emirates ID application alongside the visa. They are separate documents with separate expiry dates.", "where": "ICP portal or typing centre"},
    {"title": "Complete visa stamping", "detail": "Submit the passport for the residence stamp or e-visa issue and confirm the new expiry date in writing.", "where": "GDRFA or ICP portal"}
  ],
  "documents_required": ["Passport valid for at least six months", "Existing visa copy", "Passport size photograph with white background", "Medical fitness certificate", "Active medical insurance certificate", "Valid establishment card", "Signed labour contract"]
}
$json$::jsonb),

(null, 'emirates_id', 'Emirates ID', 'employee', '{90,60,30,7,0}', 14, 400, $json$
{
  "steps": [
    {"title": "Submit the renewal application", "detail": "Apply within thirty days of expiry. Late renewal accrues a daily fine.", "where": "ICP portal or an accredited typing centre"},
    {"title": "Attend biometrics if requested", "detail": "Not always required on renewal. The application status will say if a visit is needed.", "where": "ICP customer happiness centre"},
    {"title": "Collect the card", "detail": "The card is delivered by courier to the registered address. Track it and record the new expiry.", "where": "Emirates Post tracking"}
  ],
  "documents_required": ["Original passport", "Existing Emirates ID", "Valid residence visa", "Passport size photograph"]
}
$json$::jsonb),

(null, 'labour_card', 'Labour Card / Work Permit', 'employee', '{90,60,30,7,0}', 14, 1500, $json$
{
  "steps": [
    {"title": "Verify the labour contract", "detail": "Confirm the contract terms on file match what the employee actually signed. Mismatches are the usual cause of rejection.", "where": "MOHRE portal"},
    {"title": "Renew the work permit", "detail": "Submit through the MOHRE portal or a Tasheel centre and pay the fee.", "where": "MOHRE portal or Tasheel"},
    {"title": "File the renewed contract", "detail": "Both parties sign the renewed contract electronically. Keep a countersigned copy on file.", "where": "MOHRE portal"}
  ],
  "documents_required": ["Valid trade licence", "Employee passport copy", "Employee photograph", "Valid residence visa", "Signed offer letter or contract"]
}
$json$::jsonb),

(null, 'medical_insurance', 'Medical Insurance', 'employee', '{60,30,14,7,0}', 14, 2500, $json$
{
  "steps": [
    {"title": "Request renewal terms", "detail": "Ask the broker for renewal terms six weeks out. Premiums move with claims history, so budget early.", "where": "Insurance broker"},
    {"title": "Reconcile the member list", "detail": "Add joiners and remove leavers before renewing. Paying for departed staff is the most common quiet waste here.", "where": "Internal HR records"},
    {"title": "Confirm cover meets the regulator minimum", "detail": "The policy must meet the DHA or DOH minimum benefit plan or the visa will not be stamped.", "where": "Broker confirmation letter"},
    {"title": "Distribute new cards", "detail": "Circulate the new insurance cards and store the certificate against each employee.", "where": "Insurer portal"}
  ],
  "documents_required": ["Existing policy schedule", "Updated member census", "Trade licence copy", "Emirates ID copies for all members"]
}
$json$::jsonb),

(null, 'ejari', 'Ejari Tenancy Contract', 'property', '{90,60,30,7,0}', 14, 3000, $json$
{
  "steps": [
    {"title": "Agree renewal terms with the landlord", "detail": "Rent increases are capped by the RERA rental index. Check the calculator before accepting an increase.", "where": "Dubai REST app or RERA rental increase calculator"},
    {"title": "Sign the new tenancy contract", "detail": "Ninety days notice is required to change terms, so start this early.", "where": "Landlord or property manager"},
    {"title": "Register with Ejari", "detail": "Registration is what makes the contract usable for licence and visa renewals. An unregistered contract is not accepted.", "where": "Ejari portal or a registered typing centre"},
    {"title": "Update utilities", "detail": "Transfer or renew the DEWA account against the new contract.", "where": "DEWA portal"}
  ],
  "documents_required": ["Signed tenancy contract", "Title deed copy", "Landlord passport and Emirates ID", "Tenant trade licence", "Previous Ejari certificate", "DEWA account number"]
}
$json$::jsonb),

(null, 'vehicle_mulkiya', 'Vehicle Registration (Mulkiya)', 'vehicle', '{60,30,14,7,0}', 3, 500, $json$
{
  "steps": [
    {"title": "Clear all traffic fines", "detail": "Registration is blocked while any fine is unpaid. Check every emirate, not just the one of registration.", "where": "RTA, Abu Dhabi Police or the relevant emirate police portal"},
    {"title": "Renew motor insurance", "detail": "The insurance certificate must be valid for at least thirteen months from the registration date.", "where": "Insurer or broker"},
    {"title": "Pass the vehicle inspection", "detail": "Required for vehicles over three years old. Book ahead at month end when centres are busiest.", "where": "Tasjeel, Shamil or Wasel testing centre"},
    {"title": "Pay and collect the new card", "detail": "Renew online once the inspection is passed. The card arrives by courier.", "where": "RTA app or portal"}
  ],
  "documents_required": ["Existing registration card", "Valid motor insurance certificate", "Passing inspection certificate", "Emirates ID of the registered owner", "Trade licence if company owned"]
}
$json$::jsonb),

(null, 'civil_defence', 'Civil Defence Certificate', 'property', '{90,60,30,7,0}', 30, 2000, $json$
{
  "steps": [
    {"title": "Book the annual inspection", "detail": "Arrange the fire alarm and suppression system inspection with an approved contractor before applying.", "where": "Civil Defence approved maintenance contractor"},
    {"title": "Close any open observations", "detail": "Rectify findings from the last inspection. Open items will fail the renewal outright.", "where": "Facilities contractor"},
    {"title": "Submit the renewal", "detail": "Upload the maintenance contract and inspection report, then pay the fee.", "where": "Civil Defence portal for the relevant emirate"}
  ],
  "documents_required": ["Valid trade licence", "Annual maintenance contract with an approved contractor", "Previous civil defence certificate", "Fire system inspection report", "Ejari or tenancy contract"]
}
$json$::jsonb),

(null, 'iso_certificate', 'ISO Certificate', 'entity', '{120,90,60,30,0}', 60, 15000, $json$
{
  "steps": [
    {"title": "Schedule the surveillance or recertification audit", "detail": "Recertification falls in year three and takes materially longer than a surveillance audit. Book at least two months ahead.", "where": "Certification body"},
    {"title": "Run the internal audit and management review", "detail": "Both must be evidenced and dated before the external audit. Missing records are the most common non-conformity.", "where": "Internal quality function"},
    {"title": "Close prior non-conformities", "detail": "Evidence corrective action for every finding raised at the last audit.", "where": "Internal quality function"},
    {"title": "Host the audit and collect the certificate", "detail": "Record the new expiry and the certificate number.", "where": "Certification body"}
  ],
  "documents_required": ["Current certificate", "Internal audit report", "Management review minutes", "Corrective action records", "Updated process documentation"]
}
$json$::jsonb),

(null, 'passport', 'Passport', 'employee', '{180,90,60,30,0}', 30, 1000, $json$
{
  "steps": [
    {"title": "Check remaining validity against visa needs", "detail": "Most UAE visa transactions require at least six months of passport validity, so treat six months out as the real deadline.", "where": "Internal HR records"},
    {"title": "Apply through the home country embassy or consulate", "detail": "Processing times vary widely by nationality. Confirm the current turnaround before promising a date.", "where": "Relevant embassy or consulate"},
    {"title": "Transfer the residence visa to the new passport", "detail": "A new passport does not carry the visa across automatically. This step is missed constantly and causes travel refusals.", "where": "GDRFA or ICP portal"}
  ],
  "documents_required": ["Existing passport", "Passport photographs to the embassy specification", "Emirates ID copy", "Residence visa copy", "Completed application form"]
}
$json$::jsonb),

(null, 'vat_registration', 'VAT Registration Certificate', 'entity', '{90,60,30,7,0}', 20, 0, $json$
{
  "steps": [
    {"title": "Confirm registration details are current", "detail": "Business activity, bank details and authorised signatory changes must be notified within twenty business days or penalties apply.", "where": "EmaraTax portal"},
    {"title": "Reconcile filed returns", "detail": "Ensure every return is filed and paid. Outstanding liabilities complicate any amendment.", "where": "EmaraTax portal"},
    {"title": "Download the current certificate", "detail": "Keep the latest certificate on file for customers who request it.", "where": "EmaraTax portal"}
  ],
  "documents_required": ["Trade licence", "Emirates ID and passport of the authorised signatory", "Bank account validation letter", "Previous VAT certificate"]
}
$json$::jsonb);
