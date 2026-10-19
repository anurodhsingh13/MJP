import {test,expect} from '@playwright/test';
test('showcase 7-day forecast stays separate from historical weather and is field-selectable',async({page})=>{
 await page.goto('/?demo=1');
 const forecast=page.getByRole('article',{name:'Next seven days weather forecast'});
 await expect(forecast).toBeVisible();
 await expect(forecast.locator('.forecast-day')).toHaveCount(7);
 await expect(forecast).toContainText('Synthetic showcase');
 await expect(page.getByText('Historical NASA POWER data; not a forecast.')).toBeVisible();
 await forecast.getByLabel('Choose field').selectOption({label:'Rice East'});
 await expect(forecast.locator('.forecast-day')).toHaveCount(7);
 await expect(forecast).toContainText('Retrieved');
});
