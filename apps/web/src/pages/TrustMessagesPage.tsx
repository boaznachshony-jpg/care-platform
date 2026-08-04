/* eslint-disable no-restricted-syntax */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';

interface TrustMessage {
  title: string;
  hebrew: string;
  english: string;
  uzbek?: string;
  russian?: string;
}

const messages: TrustMessage[] = [
  {
    title: 'פתיחת היום',
    hebrew: 'בוקר טוב, איך את או אתה מרגישים היום?',
    english: 'Good morning. How are you feeling today?',
    uzbek: 'Xayrli tong. Bugun o‘zingizni qanday his qilyapsiz?',
    russian: 'Доброе утро. Как вы себя сегодня чувствуете?',
  },
  {
    title: 'הבעת הערכה',
    hebrew: 'תודה רבה, אני מעריך או מעריכה את העזרה שלך.',
    english: 'Thank you. I appreciate your help.',
    uzbek: 'Rahmat. Yordamingizni qadrlayman.',
    russian: 'Спасибо. Я ценю вашу помощь.',
  },
  {
    title: 'תיאום ציפיות',
    hebrew: 'בואו נעבור יחד על התוכנית להיום.',
    english: 'Let us review today’s plan together.',
    uzbek: 'Keling, bugungi rejani birga ko‘rib chiqamiz.',
    russian: 'Давайте вместе обсудим план на сегодня.',
  },
  {
    title: 'בדיקת צרכים',
    hebrew: 'האם יש משהו שחשוב לך שנדע או משהו שנוכל לעזור בו?',
    english: 'Is there anything important you would like us to know or help with?',
    uzbek: 'Biz bilishimiz yoki yordam berishimiz kerak bo‘lgan biror narsa bormi?',
    russian: 'Есть ли что-то важное, что нам следует знать, или чем мы можем помочь?',
  },
];

function translatedMessage(message: TrustMessage, language: string): string {
  if (language === 'אוזבקית') return message.uzbek ?? message.english;
  if (language === 'רוסית') return message.russian ?? message.english;
  return message.english;
}

export function TrustMessagesPage() {
  const path = useClientPath();
  const [profile] = useMvpProfile();
  const [copied, setCopied] = useState('');
  const language = profile.caregiverLanguage || 'אנגלית';

  async function copyMessage(message: TrustMessage) {
    const text = translatedMessage(message, language);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(message.title);
    } catch {
      setCopied('');
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">תקשורת מכבדת</p>
          <h1>מסרים לבניית אמון</h1>
          <p>
            משפטים קצרים לשיחה עם {profile.caregiverName || 'המטפל או המטפלת'} בשפה {language}.
            התאימו תמיד את הניסוח לאדם ולהעדפותיו.
          </p>
        </div>
        <div className="page-header-actions">
          <Link className="secondary-button" to={path('/glossary')}>
            למושגים חשובים
          </Link>
          <Link className="secondary-button" to={path('/employee')}>
            לפרטי המטפל
          </Link>
        </div>
      </header>

      {!profile.caregiverCountry || !profile.caregiverLanguage ? (
        <section className="card attention-panel">
          <h2>כדי להתאים את המסרים, השלימו ארץ מוצא ושפה מועדפת</h2>
          <Link className="primary-button" to={path('/employee')}>
            השלמת הפרטים
          </Link>
        </section>
      ) : (
        <p className="info-box">
          ארץ מוצא: {profile.caregiverCountry} · שפה שנבחרה: {language}
        </p>
      )}

      <section className="trust-message-grid">
        {messages.map((message) => (
          <article className="card trust-message-card" key={message.title}>
            <h2>{message.title}</h2>
            <div>
              <small>עברית</small>
              <p>{message.hebrew}</p>
            </div>
            <div dir="ltr">
              <small>{language}</small>
              <p>{translatedMessage(message, language)}</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyMessage(message)}
            >
              {copied === message.title ? 'הועתק' : 'העתקת המסר'}
            </button>
          </article>
        ))}
      </section>
      <p className="form-note">
        התרגומים הם כלי עזר לשיחה יומיומית ואינם מיועדים למסרים רפואיים, משפטיים או למצבי חירום.
      </p>
    </div>
  );
}
