(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const intro = $("#intro");
  const assessment = $("#assessment");
  const results = $("#results");
  const questionRegion = $("#question-region");
  const progress = $(".progress-track");
  const progressFill = $("#progress-fill");
  const progressCopy = $("#progress-copy");
  const stepLabel = $("#step-label");
  const continueButton = $("#continue-button");
  const backButton = $("#back-button");
  const skipButton = $("#skip-button");
  const state = { answers: {}, history: [], current: "industry" };

  const questions = {
    industry: {
      label: "BUSINESS DISCOVERY",
      title: "What best describes your business?",
      help: "We'll tailor the next questions to your industry.",
      options: ["Beauty & Personal Care", "Fashion & Retail", "Food & Hospitality", "Professional Services", "Health & Wellness", "Construction & Home Services", "Other"]
    },
    booking: {
      label: "CUSTOMER EXPERIENCE",
      title: "How do customers currently book or enquire about your services?",
      help: "Choose the main way customers get in touch.",
      options: ["WhatsApp", "Phone calls", "Instagram or Facebook messages", "A website with an online booking system", "Walk-ins", "A combination of several methods", "Other"]
    },
    enquiry_process: {
      label: "CUSTOMER EXPERIENCE",
      title: "How would you describe your current enquiry and booking experience?",
      help: "This helps us understand whether your current process is working for you.",
      options: ["It works well and is easy to manage", "It works, but managing enquiries and bookings can be difficult", "I sometimes miss messages or forget to follow up", "Customers often enquire but don't complete bookings", "I don't have a consistent booking process", "I'm not sure"]
    },
    discovery: {
      label: "ONLINE PRESENCE",
      title: "Where can potential customers currently find your business online?",
      help: "Select the option that best describes your current presence.",
      options: ["Instagram and Facebook", "Instagram only", "Facebook only", "Instagram, Facebook and Google Business Profile", "A website and social media", "Google Business Profile only", "I have no established online presence", "Other"]
    },
    challenge: {
      label: "BUSINESS PRIORITIES",
      title: "What would you most like to improve in your business?",
      help: "Choose the area that matters most right now.",
      options: ["Getting more enquiries from potential customers", "Turning more enquiries into paying customers", "Presenting my business more professionally", "Making bookings, orders or customer communication easier", "Improving how customers find my business online", "I'm not sure yet"]
    }
  };

  const industrySpecific = {
    "Beauty & Personal Care": {
      bookingTitle: "How do customers currently book appointments or enquire about your services?"
    },
    "Fashion & Retail": {
      bookingTitle: "How do customers currently browse or place orders?"
    },
    "Food & Hospitality": {
      bookingTitle: "How do customers currently place orders or make reservations?"
    },
    "Professional Services": {
      bookingTitle: "How do potential clients usually enquire about your services?"
    },
    "Health & Wellness": {
      bookingTitle: "How do clients currently book sessions or enquire?"
    },
    "Construction & Home Services": {
      bookingTitle: "How do customers currently request a quote or arrange a service?"
    }
  };

  const sequence = ["industry", "booking", "enquiry_process", "discovery", "challenge"];
  const labels = ["Business discovery", "Customer journey", "Customer journey", "Online presence", "Business priorities"];

  function showQuestion(key) {
    state.current = key;
    const question = questions[key];
    const value = state.answers[key] || "";
    const index = sequence.indexOf(key);
    stepLabel.textContent = question.label;
    progressCopy.textContent = "Question " + (index + 1) + " of " + sequence.length;
    progressFill.style.width = (((index + 1) / sequence.length) * 100) + "%";
    progress.setAttribute("aria-valuenow", String(Math.round(((index + 1) / sequence.length) * 100)));
    backButton.disabled = index === 0;
    continueButton.disabled = !value;
    continueButton.textContent = key === "challenge" ? "Generate my assessment →" : "Continue →";
    const title = key === "booking" && industrySpecific[state.answers.industry]
      ? industrySpecific[state.answers.industry].bookingTitle
      : question.title;
    questionRegion.replaceChildren();
    const heading = document.createElement("h2");
    heading.className = "question-title";
    heading.textContent = title;
    const help = document.createElement("p");
    help.className = "question-help";
    help.textContent = question.help;
    const list = document.createElement("div");
    list.className = "option-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", title);
    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.setAttribute("aria-pressed", String(value === option));
      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = option;
      button.append(mark, text);
      button.addEventListener("click", () => {
        state.answers[key] = option;
        list.querySelectorAll(".option").forEach((item) => item.setAttribute("aria-pressed", "false"));
        button.setAttribute("aria-pressed", "true");
        continueButton.disabled = false;
      });
      list.append(button);
    });
    questionRegion.append(heading, help, list);
  }

  function findingsForAnswers(answers) {
    const findings = [];
    const enquiry = answers.enquiry_process || "";
    const booking = answers.booking || "";
    const presence = answers.discovery || "";
    const noWebsite = !presence.toLowerCase().includes("website");
    if (/miss messages|forget to follow up|difficult|don't have a consistent/i.test(enquiry)) {
      findings.push({
        title: "Make enquiry follow-ups more consistent",
        status: "Priority to explore",
        detail: "You indicated that enquiries can be missed, follow-ups are sometimes forgotten, or the process is difficult to manage. A simple way to capture and track open enquiries may help reduce avoidable gaps.",
        service: "Potential fit: enquiry workflows and customer communication support."
      });
    }
    if (/don't complete bookings|consistent booking process|difficult/i.test(enquiry) || /WhatsApp|Instagram|Facebook messages|Phone calls/.test(booking)) {
      findings.push({
        title: "Review the booking or order journey",
        status: "Opportunity to explore",
        detail: "Your customers rely on direct communication to take the next step. Review whether the current process makes it clear what information customers need, how a booking is confirmed and what happens next.",
        service: "Potential fit: booking system setup or a clearer enquiry process."
      });
    }
    if (noWebsite) {
      findings.push({
        title: "Consider a central online destination",
        status: "Growth opportunity",
        detail: "Based on your answer, a website is not currently part of the online presence you selected. A focused website could bring key business information, services or products and contact options together. Whether it is worthwhile depends on your goals and customer behaviour.",
        service: "Potential fit: website design and development."
      });
    }
    if (/Google Business Profile/.test(presence) || /no established online presence|only/.test(presence)) {
      findings.push({
        title: "Review your online discoverability",
        status: "Needs verification",
        detail: "Your selected channels provide a starting point for discovery. A review of profile accuracy, service information, photographs, reviews and contact links would help identify specific improvements.",
        service: "Potential fit: Google Business Profile and digital presence optimisation."
      });
    }
    if (!findings.length) {
      findings.push({
        title: "Build on what's already working",
        status: "Further discovery",
        detail: "Your answers have not established a clear operational weakness. A closer review of your business goals, customer journey and existing materials would help identify useful opportunities without assuming something is broken.",
        service: "Potential fit: a focused business and digital presence review."
      });
    }
    return findings.slice(0, 4);
  }

  function renderResults() {
    const answers = state.answers;
    const findings = findingsForAnswers(answers);
    $("#result-title").textContent = "Your " + (answers.industry || "business") + " opportunity report";
    $("#result-intro").textContent = "Your answers suggest a few areas worth exploring. We've prioritised the recommendations below based on what you told us, not on assumptions about what every business should buy.";
    const container = $("#result-findings");
    container.replaceChildren();
    findings.forEach((finding) => {
      const card = document.createElement("article");
      card.className = "finding";
      const top = document.createElement("div");
      top.className = "finding-top";
      const heading = document.createElement("h3");
      heading.textContent = finding.title;
      const status = document.createElement("span");
      status.className = "status-label";
      status.textContent = finding.status;
      top.append(heading, status);
      const detail = document.createElement("p");
      detail.textContent = finding.detail;
      const service = document.createElement("p");
      service.className = "service-match";
      service.textContent = finding.service;
      card.append(top, detail, service);
      container.append(card);
    });
    assessment.hidden = true;
    intro.hidden = true;
    results.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#start-button").addEventListener("click", () => {
    intro.hidden = true;
    assessment.hidden = false;
    showQuestion("industry");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  continueButton.addEventListener("click", () => {
    const index = sequence.indexOf(state.current);
    if (index === sequence.length - 1) {
      renderResults();
      return;
    }
    state.history.push(state.current);
    showQuestion(sequence[index + 1]);
  });

  backButton.addEventListener("click", () => {
    const previous = state.history.pop();
    if (previous) showQuestion(previous);
  });

  skipButton.addEventListener("click", () => {
    const index = sequence.indexOf(state.current);
    delete state.answers[state.current];
    if (index === sequence.length - 1) {
      renderResults();
      return;
    }
    state.history.push(state.current);
    showQuestion(sequence[index + 1]);
  });

  $("#exit-button").addEventListener("click", () => {
    assessment.hidden = true;
    intro.hidden = false;
  });

  $("#restart-button").addEventListener("click", () => {
    state.answers = {};
    state.history = [];
    results.hidden = true;
    intro.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("#proposal-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    $("#form-status").textContent = "The proposal request connection is not active in this prototype. Your details have not been submitted.";
  });
})();